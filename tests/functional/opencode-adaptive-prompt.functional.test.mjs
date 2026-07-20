/**
 * tests/functional/opencode-adaptive-prompt.functional.test.mjs
 *
 * Asserts that the OpenCode `construct` agent prompt is sized to the configured default
 * model's capability tier. Spawns the real sync-worker-profiles.mjs into an isolated tmp HOME
 * seeded with (a) a small local default (7B → floor), (b) a mid local default (30B → mid),
 * and (c) a cloud default (→ full, unchanged). Verifies the floor keeps the Worker Profile
 * identity and orchestration handoff while omitting optional sections, and that mid/full
 * retain the current unmarked (default priority 2) Worker Profile sections. The host binary
 * is never executed, and every spawn uses a sterile HOME/XDG/state root.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { rmTmpDir } from '../helpers/cleanup.mjs';
import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SYNC_SCRIPT = join(REPO_ROOT, "scripts", "sync-worker-profiles.mjs");

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
      env: sterileSpawnEnv({
        HOME: env.sandbox,
        CONSTRUCT_HOME_OVERRIDE: env.sandbox,
        CONSTRUCT_SKIP_POSTINSTALL: "1",
      }),
    });
    assert.equal(res.status, 0, `sync failed: ${(res.stderr || "").slice(-400)}`);
    const out = JSON.parse(readFileSync(env.cfgPath, "utf8"));
    return out.agent?.construct?.prompt ?? "";
  } finally {
    env.cleanup();
  }
}

// The canonical Construct 2.0 prompt has an implicit priority-1 preamble and unmarked
// sections, which default to priority 2. Floor therefore keeps identity and scope; mid
// and full retain all current sections until an author explicitly marks priority 3.

const FLOOR_IDENTITY = ["You are orchestrator", "Scope boundary"];
const MID_SECTIONS = ["Anti-fabrication contract", "Quality gates", "Drive mode"];
const MICRO_PROMPT = "call `construct-mcp_orchestration_policy`";
const EXECUTION_PROMPT = "call `construct-mcp_orchestration_run`";

test("small local default (7B) renders the floor tier", () => {
  const prompt = syncAndReadPrompt(seedConfig("ollama/qwen2.5-coder:7b-cx32k", true));
  for (const anchor of FLOOR_IDENTITY) assert.match(prompt, new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `floor must keep: ${anchor}`);
  assert.match(prompt, new RegExp(MICRO_PROMPT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "orchestration micro-prompt present");
  assert.match(prompt, new RegExp(EXECUTION_PROMPT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "execution handoff present");
  for (const section of MID_SECTIONS) assert.doesNotMatch(prompt, new RegExp(`## ${section}`), `floor drops optional section: ${section}`);
  assert.doesNotMatch(prompt, /construct:prio/, "section markers must not leak into the emitted prompt");
});

test("mid local default (30B) keeps the current default-priority Worker Profile sections", () => {
  const prompt = syncAndReadPrompt(seedConfig("ollama/qwen3-coder:30b-cx32k", true));
  for (const section of MID_SECTIONS) assert.match(prompt, new RegExp(`## ${section}`), `mid keeps default-priority section: ${section}`);
  assert.match(prompt, /workerProfileId: orchestrator/, "Worker Profile metadata remains available");
});

test("cloud default renders the full persona, unchanged", () => {
  const prompt = syncAndReadPrompt(seedConfig("anthropic/claude-opus-4-6", false));
  for (const section of MID_SECTIONS) assert.match(prompt, new RegExp(`## ${section}`), `full keeps section: ${section}`);
  assert.match(prompt, /workerProfileId: orchestrator/, "full prompt carries Worker Profile metadata");
  assert.doesNotMatch(prompt, /construct:prio/, "section markers must not leak into the full prompt");
});

test("floor prompt is materially smaller than the full cloud prompt", () => {
  const floor = syncAndReadPrompt(seedConfig("ollama/qwen2.5-coder:7b-cx32k", true));
  const full = syncAndReadPrompt(seedConfig("anthropic/claude-opus-4-6", false));
  assert.ok(floor.length < full.length * 0.7, `floor (${floor.length}) should be < 70% of full (${full.length})`);
});
