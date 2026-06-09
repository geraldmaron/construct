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

// Repetition collapse on an agentic prompt is model-specific and not predictable
// from parameter count alone (a 7B coder model collapses where a 30B does not), so
// capability is probed empirically: feed a representative system prompt + one tool +
// a question and measure immediate-repeat density. A coherent model answers; an
// incapable one degenerates into "given given given". Requires the model loaded in
// Ollama, so it is opt-in (doctor / on demand), never run inline on every sync.

const PROBE_SYSTEM = "You are an interactive coding agent. Use the available tools to help the user with software engineering tasks. Be concise and accurate.";
const PROBE_TOOL = {
  type: "function",
  function: {
    name: "read",
    description: "Read a file from the project",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
};

function immediateRepeatRatio(text) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 8) return 0;
  let repeats = 0;
  for (let i = 1; i < words.length; i++) if (words[i].toLowerCase() === words[i - 1].toLowerCase()) repeats++;
  return repeats / words.length;
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
          { role: "user", content: "What kind of project is in the current directory? Answer in one sentence." },
        ],
        tools: [PROBE_TOOL],
        stream: false,
        temperature: 0.2,
      }),
    });
    if (!res.ok) return { model, ok: false, reason: `http-${res.status}` };
    const data = await res.json();
    const msg = data?.choices?.[0]?.message || {};
    const text = msg.content || "";
    const calledTool = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
    const repeatRatio = immediateRepeatRatio(text);
    const coherent = calledTool || (text.length > 0 && repeatRatio < 0.25);
    return { model, ok: true, coherent, calledTool, repeatRatio: Number(repeatRatio.toFixed(2)), sample: text.slice(0, 120) };
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
      console.log(`${m}: ${verdict}${r.ok ? ` (repeat=${r.repeatRatio}, tool=${r.calledTool})` : ""}${r.sample ? ` — ${JSON.stringify(r.sample)}` : ""}`);
    }
    process.exit(0);
  }
  const dryRun = process.argv.includes("--dry-run");
  const numArg = process.argv.find((a) => a.startsWith("--num-ctx="));
  const numCtx = numArg ? Number(numArg.split("=")[1]) : DEFAULT_NUM_CTX;
  const result = ensureLocalContextVariants({ numCtx, dryRun });
  console.log(JSON.stringify(result, null, 2));
}
