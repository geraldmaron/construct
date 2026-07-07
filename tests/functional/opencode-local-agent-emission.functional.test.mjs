/**
 * tests/functional/opencode-local-agent-emission.functional.test.mjs
 *
 * Asserts the hybrid architect/editor split. Spawns the real sync-specialists.mjs into an
 * isolated tmp HOME. When the fast tier resolves local, sync emits a `construct-local`
 * editor: mode subagent, pinned to the local fast model, escalation directive in the
 * prompt, tightened tool surface (orchestration denied), and task limited to handing off
 * to construct. When the fast tier is cloud, no editor is emitted — and a stale editor
 * left in the config is removed. The host binary is never executed.
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

function seededHome(config) {
  const sandbox = mkdtempSync(join(tmpdir(), "oc-localagent-"));
  const cfgPath = join(sandbox, ".config", "opencode", "opencode.json");
  mkdirSync(dirname(cfgPath), { recursive: true });
  writeFileSync(cfgPath, JSON.stringify(config, null, 2) + "\n");
  return { sandbox, cfgPath, cleanup() { rmTmpDir(sandbox); } };
}

function syncAndRead(config) {
  const env = seededHome(config);
  try {
    const res = spawnSync(process.execPath, [SYNC_SCRIPT, "--global"], {
      cwd: REPO_ROOT, encoding: "utf8", timeout: 90_000,
      env: { ...process.env, HOME: env.sandbox, CONSTRUCT_SKIP_POSTINSTALL: "1" },
    });
    assert.equal(res.status, 0, `sync failed: ${(res.stderr || "").slice(-400)}`);
    return JSON.parse(readFileSync(env.cfgPath, "utf8"));
  } finally {
    env.cleanup();
  }
}

const OLLAMA_PROVIDER = {
  npm: "@ai-sdk/openai-compatible",
  name: "Ollama",
  options: { baseURL: "http://127.0.0.1:11434/v1" },
  models: {
    "llama3.2:latest-cx32k": { name: "llama3.2:latest-cx32k" },
    "qwen2.5-coder:7b-cx32k": { name: "qwen2.5-coder:7b-cx32k" },
    "qwen3-coder:30b-cx32k": { name: "qwen3-coder:30b-cx32k" },
  },
};

const baseCfg = (extra = {}) => ({
  $schema: "https://opencode.ai/config.json",
  autoupdate: false,
  mcp: {},
  provider: { ollama: OLLAMA_PROVIDER },
  ...extra,
});

test("local primary emits a construct-local editor pinned to the local fast tier", () => {
  const out = syncAndRead(baseCfg({ model: "ollama/qwen2.5-coder:7b-cx32k" }));
  const editor = out.agent?.["construct-local"];
  assert.ok(editor, "construct-local should be emitted for a local primary");
  assert.equal(editor.mode, "subagent");
  // Type-aware selection: among the declared coders (7b + 30b) the editor takes the
  // smallest in-band code model, not the generic fast-tier default.
  assert.equal(editor.model, "ollama/qwen2.5-coder:7b-cx32k", "editor uses the best-installed in-band coder");
  assert.match(editor.prompt || "", /return control to construct/, "escalation directive present");
});

test("construct-local has a tightened tool surface and spawns no subagents", () => {
  const out = syncAndRead(baseCfg({ model: "ollama/qwen2.5-coder:7b-cx32k" }));
  const perm = out.agent?.["construct-local"]?.permission ?? {};
  assert.equal(perm["mcp__construct-mcp__orchestration_policy"], "deny", "editor must not orchestrate");
  assert.equal(perm["mcp__context7__*"], "deny");
  // OpenCode disables the task tool for any restrictive map; deny-all makes the editor
  // spawn nothing and escalate by returning to its dispatcher.
  assert.equal(perm.task?.["*"], "deny", "editor may not dispatch agents");
});

test("cloud primary emits no construct-local editor", () => {
  const out = syncAndRead(baseCfg({ model: "anthropic/claude-opus-4-6" }));
  assert.equal(out.agent?.["construct-local"], undefined, "no editor for a cloud primary");
});

test("a stale construct-local is removed when the primary is cloud", () => {
  const stale = baseCfg({
    model: "anthropic/claude-opus-4-6",
    agent: { "construct-local": { description: "stale", mode: "subagent", model: "ollama/old:7b", prompt: "stale" } },
  });
  const out = syncAndRead(stale);
  assert.equal(out.agent?.["construct-local"], undefined, "stale editor must be cleaned up");
});
