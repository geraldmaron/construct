/**
 * tests/functional/opencode-adaptive-prompt.functional.test.mjs
 *
 * Asserts that the OpenCode `construct` agent prompt is sized to the configured default
 * model's capability tier. Spawns the real sync-specialists.mjs into an isolated tmp HOME
 * seeded with (a) a small local default (7B → floor), (b) a mid local default (30B → mid),
 * and (c) a cloud default (→ full, unchanged). Verifies the must-keep sections survive at
 * every tier, prio-3 sections drop for local models, prio-2 sections drop only at floor,
 * and the cloud prompt is the full persona. The host binary is never executed.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SYNC_SCRIPT = join(REPO_ROOT, "scripts", "sync-specialists.mjs");

const OLLAMA_PROVIDER = {
  npm: "@ai-sdk/openai-compatible",
  name: "Ollama",
  options: { baseURL: "http://127.0.0.1:11434/v1" },
  models: {
    "qwen2.5-coder:7b-cx32k": { name: "qwen2.5-coder:7b-cx32k" },
    "qwen3-coder:30b-cx32k": { name: "qwen3-coder:30b-cx32k" },
  },
};

function seedConfig(model, provider) {
  const base = { $schema: "https://opencode.ai/config.json", autoupdate: false, mcp: {} };
  if (model) base.model = model;
  if (provider) base.provider = { ollama: OLLAMA_PROVIDER };
  return base;
}

function seededHome(config) {
  const sandbox = mkdtempSync(join(tmpdir(), "oc-adaptive-"));
  const cfgPath = join(sandbox, ".config", "opencode", "opencode.json");
  mkdirSync(dirname(cfgPath), { recursive: true });
  writeFileSync(cfgPath, JSON.stringify(config, null, 2) + "\n");
  return { sandbox, cfgPath, cleanup() { rmTmpDir(sandbox); } };
}

function syncAndReadPrompt(config) {
  const env = seededHome(config);
  try {
    const res = spawnSync(process.execPath, [SYNC_SCRIPT, "--global"], {
      cwd: REPO_ROOT, encoding: "utf8", timeout: 90_000,
      env: { ...process.env, HOME: env.sandbox, CONSTRUCT_SKIP_POSTINSTALL: "1" },
    });
    assert.equal(res.status, 0, `sync failed: ${(res.stderr || "").slice(-400)}`);
    const out = JSON.parse(readFileSync(env.cfgPath, "utf8"));
    return out.agent?.construct?.prompt ?? "";
  } finally {
    env.cleanup();
  }
}

// Stable section anchors. Preamble + Branch/commit + Loop guard + Action discipline +
// Classify = floor (prio 1). Quality gates = prio 2 (mid). Drive mode = prio 3 (full).
const MUST_KEEP = ["Anti-fabrication contract", "Branch + commit approval", "Loop guard"];
const PRIO2 = "Quality gates";
const PRIO3 = "Drive mode";
const MICRO_PROMPT = "call `construct-mcp_orchestration_policy`";
const EXECUTION_PROMPT = "call `construct-mcp_orchestration_run`";

test("small local default (7B) renders the floor tier", () => {
  const prompt = syncAndReadPrompt(seedConfig("ollama/qwen2.5-coder:7b-cx32k", true));
  for (const anchor of MUST_KEEP) assert.match(prompt, new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `floor must keep: ${anchor}`);
  assert.match(prompt, new RegExp(MICRO_PROMPT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "orchestration micro-prompt present");
  assert.match(prompt, new RegExp(EXECUTION_PROMPT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "execution handoff present");
  assert.doesNotMatch(prompt, /Drive mode/, "floor drops prio-3 Drive mode");
  assert.doesNotMatch(prompt, /## Quality gates/, "floor drops prio-2 Quality gates");
  assert.doesNotMatch(prompt, /cx:prio/, "section markers must not leak into the emitted prompt");
});

test("mid local default (30B) keeps prio-2 but drops prio-3", () => {
  const prompt = syncAndReadPrompt(seedConfig("ollama/qwen3-coder:30b-cx32k", true));
  assert.match(prompt, /## Quality gates/, "mid keeps prio-2 Quality gates");
  assert.doesNotMatch(prompt, /Drive mode/, "mid drops prio-3 Drive mode");
});

test("cloud default renders the full persona, unchanged", () => {
  const prompt = syncAndReadPrompt(seedConfig("anthropic/claude-opus-4-6", false));
  assert.match(prompt, new RegExp(PRIO3), "full keeps prio-3 Drive mode");
  assert.match(prompt, new RegExp(`## ${PRIO2}`), "full keeps prio-2 Quality gates");
  assert.doesNotMatch(prompt, /cx:prio/, "section markers must not leak into the full prompt");
});

test("floor prompt is materially smaller than the full cloud prompt", () => {
  const floor = syncAndReadPrompt(seedConfig("ollama/qwen2.5-coder:7b-cx32k", true));
  const full = syncAndReadPrompt(seedConfig("anthropic/claude-opus-4-6", false));
  assert.ok(floor.length < full.length * 0.7, `floor (${floor.length}) should be < 70% of full (${full.length})`);
});
