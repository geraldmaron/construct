/**
 * lib/ollama/provision-context.mjs — Provision context-extended Ollama model variants.
 *
 * OpenCode reaches Ollama through the OpenAI-compatible `/v1` endpoint, which has
 * no field for the context window — so `num_ctx` set in opencode.json is silently
 * dropped and Ollama serves the model at its 4096 default. A Construct session's
 * system prompt plus MCP tool schemas overruns 4096, so a capable model loses the
 * tail of its own prompt/conversation. The only surface that actually sets Ollama's
 * runtime context is the Modelfile, so for any tool-capable model with no baked
 * `num_ctx` (capability does not track parameter count, so size is not a gate) this
 * module derives a `<model>-cx<N>k` variant via `ollama create` with the context
 * window, a safe Qwen/Llama repeat_penalty, and ChatML stop tokens baked in.
 *
 * Idempotent: a variant that already exists is left untouched. Mirrors the
 * user-provisioned qwen3-coder:32k pattern.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_NUM_CTX = 32768;
const CHATML_STOPS = ["<|im_start|>", "<|im_end|>", "<|endoftext|>"];

function ollama(args, opts = {}) {
  return spawnSync("ollama", args, { encoding: "utf8", ...opts });
}

export function ollamaAvailable() {
  const r = ollama(["--version"]);
  return r.status === 0;
}

export function listModels() {
  const r = ollama(["list"]);
  if (r.status !== 0) return [];
  return r.stdout.trim().split("\n").slice(1)
    .map((line) => line.split(/\s+/).filter(Boolean)[0])
    .filter(Boolean);
}

// `ollama show` prints a "Parameters" block listing only params baked into the
// model. `context length` under "Model" is the trained maximum, not the runtime
// window — the distinction that makes a raw model look 32k-capable while Ollama
// actually serves it at 4096.

export function inspectModel(model) {
  const r = ollama(["show", model]);
  if (r.status !== 0) return null;
  const text = r.stdout;
  const paramMatch = text.match(/parameters\s+([\d.]+)\s*([BMK])/i);
  const paramCountB = paramMatch
    ? Number(paramMatch[1]) * (paramMatch[2].toUpperCase() === "M" ? 0.001 : paramMatch[2].toUpperCase() === "K" ? 0.000001 : 1)
    : null;
  const contextMatch = text.match(/context length\s+(\d+)/i);
  const trainedContext = contextMatch ? Number(contextMatch[1]) : null;

  // `num_ctx` appears only inside the Parameters block, so a whole-text match is
  // safe (the trained-max line reads "context length", not num_ctx). `tools` is a
  // standalone line under Capabilities — match it anchored to avoid the lowercase
  // "parameters" count line elsewhere in the output.

  const bakedNumCtxMatch = text.match(/\bnum_ctx\s+(\d+)/i);
  const bakedNumCtx = bakedNumCtxMatch ? Number(bakedNumCtxMatch[1]) : null;
  const toolCapable = /^\s*tools\s*$/im.test(text);

  return { model, paramCountB, trainedContext, bakedNumCtx, toolCapable };
}

export function variantName(model, numCtx) {
  const kSuffix = `cx${Math.round(numCtx / 1024)}k`;
  const [base, tag] = model.split(":");
  return tag ? `${base}:${tag}-${kSuffix}` : `${base}:${kSuffix}`;
}

export function buildModelfile(model, numCtx) {
  const lines = [
    `FROM ${model}`,
    `PARAMETER num_ctx ${numCtx}`,
    `PARAMETER repeat_penalty 1.05`,
    `PARAMETER temperature 0.1`,
    ...CHATML_STOPS.map((s) => `PARAMETER stop "${s}"`),
  ];
  return lines.join("\n") + "\n";
}

// `ollama create` reads the Modelfile from a path, not stdin, so stage it in a
// temp dir and pass the path. Status is unreliable on some Ollama builds (exits 0
// even on "no Modelfile found"), so success is confirmed by the variant appearing
// in the model list rather than the exit code alone.

export function createVariant(model, numCtx, { dryRun = false } = {}) {
  const name = variantName(model, numCtx);
  if (dryRun) return { name, ok: true };
  const dir = mkdtempSync(join(tmpdir(), "cx-modelfile-"));
  const file = join(dir, "Modelfile");
  try {
    writeFileSync(file, buildModelfile(model, numCtx));
    const r = ollama(["create", name, "-f", file]);
    const ok = r.status === 0 && listModels().includes(name);
    return { name, ok, stderr: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Ensure every raw, tool-capable model whose runtime context falls back to the
 * default has a context-extended variant. Returns a map of raw → variant for
 * the caller (sync-config) to register, plus a per-model action log.
 */
export function ensureLocalContextVariants({ numCtx = DEFAULT_NUM_CTX, dryRun = false } = {}) {
  if (!ollamaAvailable()) return { available: false, mapping: {}, actions: [] };

  const models = listModels();
  const existing = new Set(models);
  const mapping = {};
  const actions = [];

  for (const model of models) {
    if (/:cx\d+k$/.test(model)) continue;
    const info = inspectModel(model);
    if (!info || !info.toolCapable) {
      actions.push({ model, action: "skip", reason: info ? "not-tool-capable" : "inspect-failed" });
      continue;
    }
    if (info.bakedNumCtx && info.bakedNumCtx >= numCtx) {
      actions.push({ model, action: "skip", reason: `already-baked-${info.bakedNumCtx}` });
      continue;
    }

    const name = variantName(model, numCtx);
    if (existing.has(name)) {
      mapping[model] = name;
      actions.push({ model, action: "exists", variant: name });
      continue;
    }
    const res = createVariant(model, numCtx, { dryRun });
    if (res.ok) {
      mapping[model] = res.name;
      actions.push({ model, action: dryRun ? "would-create" : "created", variant: res.name });
    } else {
      actions.push({ model, action: "error", variant: res.name, stderr: res.stderr });
    }
  }

  return { available: true, numCtx, mapping, actions };
}

// Collapse on an agentic prompt is model-specific and not predictable from
// parameter count (a 7B coder model collapses where a 30B does not). It must be
// probed with a payload heavy enough to match what a real host (OpenCode) sends:
// a light prompt + one tool is too easy — qwen2.5-coder:7b passes it yet still
// word-salads ("client client client") in OpenCode. So the stimulus below is a
// dense ~1.4k-token agentic system prompt plus a realistic ten-tool surface,
// empirically tuned (2026-06-09, validated through real OpenCode 1.15.4) to flip
// qwen2.5-coder:7b -> COLLAPSED while qwen3-coder:32k and devstral:24b stay
// COHERENT. An incapable model emits empty/no-tool output or degenerate
// repetition; a capable one calls a tool or answers coherently. Requires the
// model loaded in Ollama, so it is opt-in (doctor / on demand), never inline on sync.

const PROBE_TOOL = (name, description, properties, required) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});

const PROBE_TOOLS = [
  PROBE_TOOL("read", "Read a file from the project, optionally a line range", { path: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } }, ["path"]),
  PROBE_TOOL("write", "Write a file to disk, creating or overwriting it", { path: { type: "string" }, content: { type: "string" } }, ["path", "content"]),
  PROBE_TOOL("edit", "Replace an exact unique string in a file with a new string", { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean" } }, ["path", "old_string", "new_string"]),
  PROBE_TOOL("bash", "Execute a shell command and return its stdout and stderr", { command: { type: "string" }, timeout: { type: "number" }, description: { type: "string" } }, ["command"]),
  PROBE_TOOL("grep", "Search file contents using a regular expression", { pattern: { type: "string" }, path: { type: "string" }, glob: { type: "string" }, output_mode: { type: "string" } }, ["pattern"]),
  PROBE_TOOL("glob", "Find files whose paths match a glob pattern, sorted by mtime", { pattern: { type: "string" }, path: { type: "string" } }, ["pattern"]),
  PROBE_TOOL("list", "List the entries of a directory", { path: { type: "string" }, ignore: { type: "array", items: { type: "string" } } }, ["path"]),
  PROBE_TOOL("webfetch", "Fetch a URL and return its content as markdown text", { url: { type: "string" }, format: { type: "string" } }, ["url"]),
  PROBE_TOOL("todowrite", "Create or update the structured task list for this session", { todos: { type: "array", items: { type: "object" } } }, ["todos"]),
  PROBE_TOOL("task", "Launch a subagent to handle a complex multi-step subtask autonomously", { description: { type: "string" }, prompt: { type: "string" }, subagent_type: { type: "string" } }, ["description", "prompt"]),
];

const PROBE_SYSTEM = [
  "You are a highly capable autonomous software engineering agent embedded in a developer's terminal. You operate on a real codebase and complete tasks end to end. You are precise, methodical, and never fabricate.",
  "# Operating principles\nWork from evidence, never assumption. Before editing any file, read it. Before claiming an API exists, grep for it. Before reporting a test passes, run it and read the output. Every load-bearing statement you make must trace to something you observed through a tool call. When a fact is unknown, write that it is unknown rather than guessing.",
  "# Tool-use protocol\nYou have file, search, and shell tools. When you decide to act, emit exactly one well-formed tool call whose JSON arguments match the tool schema precisely. Do not wrap tool calls in prose, markdown fences, or explanations. Do not narrate at length what you are about to do — call the tool and let the result speak. After each tool call, read the result carefully before deciding the next step.",
  "# Workflow\n1. Understand the request fully. Restate the goal to yourself. 2. Gather context: read the README, list the directory, grep for the relevant symbols, glob for related files. 3. Form the smallest plan that satisfies the request and matches existing conventions. 4. Implement with edit or write. 5. Verify: re-read the changed file; run the build or tests via bash where applicable. 6. Report the outcome plainly, including any failures with their output.",
  "# Code conventions\nMatch the surrounding code exactly: indentation, quote style, import ordering, naming, and comment density. Do not introduce a new dependency unless asked. Do not reformat unrelated lines. Keep diffs minimal and focused on the request. Preserve the file's existing license header and structure.",
  "# Safety\nNever run destructive shell commands without explicit instruction. Never commit, push, or delete without confirmation. Treat the user's working tree as precious. If a command could be irreversible, describe it and ask first.",
  "# Communication\nBe concise in prose. Put detail into tool calls, not paragraphs. Use plain language. When the task is complete, stop and summarize what changed and how you verified it. If you could not complete the task, say exactly what blocked you.",
  "# Reasoning\nThink step by step internally, but do not dump your entire chain of thought into the response. Decide, act via a tool, observe, and iterate. Prefer doing over explaining. If multiple approaches exist, pick the one most consistent with the codebase and note the tradeoff in one sentence.",
  "# Error handling\nWhen a tool returns an error, read it, diagnose the cause, and adjust — do not repeat the same failing call. If a file is missing, search for the right path. If a command fails, inspect stderr before retrying. Bound your retries; if something cannot be done, report it honestly.",
  "# Final answer\nYour final message to the user should be a short, accurate summary grounded in what you observed. Never claim work you did not verify. Never invent file paths, function names, or results.",
].join("\n\n");

// Tokenize on word characters, not whitespace: collapse often comes out
// without spaces ("time.time.time", "clientclientclient"), which a whitespace
// split would see as a single token and miss. immediate-repeat ratio catches
// consecutive duplicates; unique-token ratio catches degenerate loops that
// aren't strictly adjacent. Either crossing its threshold means collapse.

function degeneracy(text) {
  const tokens = (text || "").toLowerCase().match(/\w+/g) || [];
  if (tokens.length < 8) return { repeatRatio: 0, uniqueRatio: 1, tokens: tokens.length };
  let repeats = 0;
  for (let i = 1; i < tokens.length; i++) if (tokens[i] === tokens[i - 1]) repeats++;
  return {
    repeatRatio: repeats / tokens.length,
    uniqueRatio: new Set(tokens).size / tokens.length,
    tokens: tokens.length,
  };
}

export async function probeAgenticCoherence(model, { baseURL = "http://127.0.0.1:11434/v1", timeoutMs = 60000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: PROBE_SYSTEM },
          { role: "user", content: "What kind of project is in the current directory? Investigate with your tools, then answer in one sentence." },
        ],
        tools: PROBE_TOOLS,
        stream: false,
        temperature: 0.2,
      }),
    });
    if (!res.ok) return { model, ok: false, reason: `http-${res.status}` };
    const data = await res.json();
    const msg = data?.choices?.[0]?.message || {};
    const text = msg.content || "";
    const calledTool = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
    const { repeatRatio, uniqueRatio, tokens } = degeneracy(text);
    const degenerate = tokens >= 8 && (repeatRatio >= 0.25 || uniqueRatio <= 0.35);
    const coherent = calledTool || (text.trim().length > 0 && !degenerate);
    return { model, ok: true, coherent, calledTool, repeatRatio: Number(repeatRatio.toFixed(2)), uniqueRatio: Number(uniqueRatio.toFixed(2)), sample: text.slice(0, 120) };
  } catch (err) {
    return { model, ok: false, reason: err.name === "AbortError" ? "timeout" : err.message };
  } finally {
    clearTimeout(timer);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--probe")) {
    const model = process.argv.find((a) => a.startsWith("--model="))?.split("=")[1];
    const targets = model ? [model] : listModels();
    for (const m of targets) {
      const r = await probeAgenticCoherence(m);
      const verdict = !r.ok ? `unavailable (${r.reason})` : r.coherent ? "COHERENT" : "COLLAPSED";
      console.log(`${m}: ${verdict}${r.ok ? ` (repeat=${r.repeatRatio}, unique=${r.uniqueRatio}, tool=${r.calledTool})` : ""}${r.sample ? ` — ${JSON.stringify(r.sample)}` : ""}`);
    }
    process.exit(0);
  }
  const dryRun = process.argv.includes("--dry-run");
  const numArg = process.argv.find((a) => a.startsWith("--num-ctx="));
  const numCtx = numArg ? Number(numArg.split("=")[1]) : DEFAULT_NUM_CTX;
  const result = ensureLocalContextVariants({ numCtx, dryRun });
  console.log(JSON.stringify(result, null, 2));
}
