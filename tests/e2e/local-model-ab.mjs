#!/usr/bin/env node
/**
 * tests/e2e/local-model-ab.mjs — A/B harness: quantify vanilla vs Construct on a local model.
 *
 * Drives `opencode run` headlessly through the recording proxy
 * (tests/helpers/ollama-record-proxy.mjs) so each config profile's outbound
 * payload to Ollama is measured (tool count, system-prompt + total input tokens,
 * surviving sampler params) alongside the model's output. Proves where the
 * local-model "word salad" comes from: payload that overruns the model's real
 * context window, the volume of MCP tool schemas, or model-specific collapse.
 *
 * Method: a temp project carries its own opencode.json that points the ollama
 * provider at the proxy and toggles MCP servers per profile; `opencode run --dir`
 * merges it over the real user config (so MCP servers boot). HOME is not
 * sterilized — that path proved unreliable for headless `opencode run`.
 *
 * Profiles (--profile=vanilla|construct|fixed, default all):
 *   vanilla   — all Construct MCP servers disabled → built-in tools only.
 *   construct — all MCP servers enabled → full ~133-tool surface.
 *   fixed     — heavy external MCP disabled (construct-mcp kept) → pruned surface.
 *
 * Usage: node tests/e2e/local-model-ab.mjs [--model=qwen2.5-coder:7b] [--profile=fixed]
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { startRecordProxy } from "../helpers/ollama-record-proxy.mjs";

const arg = (name, dflt) => {
  const f = process.argv.find((a) => a.startsWith(`--${name}=`));
  return f ? f.split("=")[1] : dflt;
};
const MODEL = arg("model", "qwen2.5-coder:7b");
const PROFILE = arg("profile", "all");
const PROMPT = arg("prompt", "what is this project? answer in one sentence.");
const RUN_TIMEOUT_MS = Number(arg("timeout", "300000"));
const MAX_ATTEMPTS = Math.max(1, Number(arg("attempts", "2")));
const reportDir = join(process.cwd(), "tests", "e2e", "reports");

const OFF = { enabled: false };
const MCP_PROFILES = {
  vanilla: { "construct-mcp": OFF, context7: OFF, github: OFF, memory: OFF, "sequential-thinking": OFF },
  construct: {},
  fixed: { context7: OFF, github: OFF, memory: OFF, "sequential-thinking": OFF },
};

function repetitionScore(text) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 8) return { score: 0, words: words.length };
  let repeats = 0;
  for (let i = 1; i < words.length; i++) if (words[i].toLowerCase() === words[i - 1].toLowerCase()) repeats++;
  return { score: repeats / words.length, words: words.length };
}

async function runProfile(profile, port) {
  const project = mkdtempSync(join(tmpdir(), `ab-${profile}-`));
  spawnSync("git", ["init", "-q"], { cwd: project });
  writeFileSync(join(project, "README.md"), "# Acme Dashboard\nAn admin dashboard, React frontend + Node/Express API.\n");
  writeFileSync(join(project, "server.js"), "import express from 'express';\nconst app = express();\n");

  const logPath = join(tmpdir(), `ab-${profile}.jsonl`);
  const proxy = await startRecordProxy({ port, logPath, label: profile });

  const cfg = {
    $schema: "https://opencode.ai/config.json",
    provider: { ollama: { options: { baseURL: proxy.url } } },
    mcp: MCP_PROFILES[profile] || {},
  };
  writeFileSync(join(project, "opencode.json"), JSON.stringify(cfg, null, 2));

  const runOnce = () => new Promise((resolve) => {
    const child = spawn("opencode", ["run", PROMPT, "-m", `ollama/${MODEL}`, "--dir", project, "--format", "json"], { cwd: project });
    let out = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve({ out, timedOut: true }); }, RUN_TIMEOUT_MS);
    child.stdout.on("data", (d) => { out += d; });
    child.on("close", () => { clearTimeout(timer); resolve({ out, timedOut: false }); });
    child.on("error", () => { clearTimeout(timer); resolve({ out, timedOut: false }); });
  });

  const parseText = (out) => {
    let text = "";
    for (const line of out.split("\n")) {
      try { const ev = JSON.parse(line); if (ev?.type === "text") text += ev.part?.text || ""; } catch { /* non-json */ }
    }
    return text;
  };

  // Headless `opencode run --format json` returns empty output intermittently in
  // some repos (host quirk, not a model verdict). Retry on empty-and-not-timed-out
  // so a flaky empty run is recorded as FLAKY-SKIP rather than miscounted as an
  // incoherent model. A timeout is a real signal and stops the retries.
  let output = { out: "", timedOut: false };
  let text = "";
  let attempts = 0;
  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    output = await runOnce();
    text = parseText(output.out);
    if (text.length > 0 || output.timedOut) break;
  }
  const flakySkip = text.length === 0 && !output.timedOut;

  await proxy.close();

  const main = proxy.records.reduce((a, b) => ((b.toolCount || 0) > (a.toolCount || 0) ? b : a), {});
  rmSync(project, { recursive: true, force: true });

  return {
    profile,
    model: MODEL,
    toolCount: main.toolCount ?? null,
    systemPromptTokensEst: main.systemPromptTokensEst ?? null,
    totalInputTokensEst: main.totalInputTokensEst ?? null,
    samplerKeysPresent: main.samplerKeysPresent ?? [],
    repetition: repetitionScore(text),
    coherent: !flakySkip && text.length > 0 && repetitionScore(text).score < 0.25,
    flakySkip,
    attempts,
    timedOut: output.timedOut,
    outputSample: text.slice(0, 300),
  };
}

async function main() {
  const profiles = PROFILE === "all" ? ["vanilla", "fixed", "construct"] : [PROFILE];
  const results = [];
  let port = 11460;
  for (const profile of profiles) {
    console.log(`\n[ab] profile=${profile} model=${MODEL}…`);
    const r = await runProfile(profile, port++);
    results.push(r);
    const verdict = r.flakySkip ? `FLAKY-SKIP (empty after ${r.attempts} attempts)` : `coherent=${r.coherent} timedOut=${r.timedOut}`;
    console.log(`[ab] ${profile}: tools=${r.toolCount} totalTok≈${r.totalInputTokensEst} repetition=${r.repetition.score.toFixed(2)} ${verdict}`);
  }
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "local-model-ab-results.json"), JSON.stringify({ model: MODEL, results }, null, 2) + "\n");
  console.log(`\n[ab] results → ${join(reportDir, "local-model-ab-results.json")}`);
}

main();
