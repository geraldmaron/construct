/**
 * opencode-mcp-trim-scoping.functional.test.mjs — bead construct-0mnj (WS2).
 *
 * The heavy external MCP servers are disabled by INTENT — the config's own
 * default model — not by whether the machine happens to have Ollama installed. A
 * cloud session on a box that also runs Ollama must keep context7/github. These
 * tests run the real sync binary in a sterile host sandbox with the REAL machine
 * Ollama visible (stubOllama:false), so a config that is not itself local proves
 * the machine signal does not leak in. --local-surface forces the decision either
 * way.
 */
import test from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHostSandbox, fingerprintRealConfigs, assertRealConfigsUnchanged } from "../helpers/sterile-host-env.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const HEAVY = ["context7", "github", "memory", "sequential-thinking", "playwright"];

function seedConfig(home, { model = undefined, ollamaModels = {} } = {}) {
  const dir = join(home, ".config", "opencode");
  mkdirSync(dir, { recursive: true });
  const mcp = { "construct-mcp": { type: "local", command: ["x"] } };
  for (const id of HEAVY) mcp[id] = { type: "local", command: ["x"] };
  const cfg = { $schema: "https://opencode.ai/config.json", mcp };
  if (model) cfg.model = model;
  if (Object.keys(ollamaModels).length) cfg.provider = { ollama: { models: ollamaModels } };
  writeFileSync(join(dir, "opencode.json"), JSON.stringify(cfg, null, 2));
  mkdirSync(join(home, ".claude", "agents"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ mcpServers: {} }));
  return join(dir, "opencode.json");
}

// sync-worker-profiles.mjs derives its own root from import.meta.dirname and
// self-populates CONSTRUCT_TOOLKIT_DIR from it when unset — it never needs the var
// supplied externally. Setting it here would also feed lib/paths.mjs's
// constructDir(), which lib/state-root.mjs's machine-scoped state root
// (ADR-0066) builds on, redirecting real state into repoRoot instead of the
// sandboxed HOME already in `env`.

function runSync(env, extraArgs = []) {
  return spawnSync(process.execPath, [join(repoRoot, "scripts", "sync-worker-profiles.mjs"), "--global", ...extraArgs], {
    env: { ...env, CONSTRUCT_SYNC_FORCE: "1", CONSTRUCT_SYNC_HOSTS: "opencode" },
    encoding: "utf8",
    timeout: 60_000,
  });
}
const mcpOf = (p) => JSON.parse(readFileSync(p, "utf8")).mcp;

test("a cloud default model keeps the heavy externals even when the machine has Ollama", () => {
  const before = fingerprintRealConfigs();
  const sandbox = createHostSandbox({ stubOllama: false });
  try {
    const cfgPath = seedConfig(sandbox.root, { model: "anthropic/claude-sonnet-4-6" });
    const r = runSync(sandbox.env);
    assert.equal(r.status, 0, `sync failed: ${r.stderr}`);
    const mcp = mcpOf(cfgPath);
    for (const id of HEAVY) assert.notEqual(mcp[id]?.enabled, false, `${id} must stay enabled for a cloud default`);
    assertRealConfigsUnchanged(before);
  } finally {
    sandbox.cleanup();
  }
});

test("a pure-cloud config (no Ollama in config) is never trimmed by mere machine presence", () => {
  const sandbox = createHostSandbox({ stubOllama: false });
  try {
    const cfgPath = seedConfig(sandbox.root, {});
    const r = runSync(sandbox.env);
    assert.equal(r.status, 0, `sync failed: ${r.stderr}`);
    const mcp = mcpOf(cfgPath);
    for (const id of HEAVY) assert.notEqual(mcp[id]?.enabled, false, `${id} must stay enabled with no local intent`);
  } finally {
    sandbox.cleanup();
  }
});

test("--local-surface=off keeps the full surface even with a local default", () => {
  const sandbox = createHostSandbox({ stubOllama: false });
  try {
    const cfgPath = seedConfig(sandbox.root, { model: "ollama/qwen3-coder:32k" });
    const r = runSync(sandbox.env, ["--local-surface=off"]);
    assert.equal(r.status, 0, `sync failed: ${r.stderr}`);
    const mcp = mcpOf(cfgPath);
    for (const id of HEAVY) assert.notEqual(mcp[id]?.enabled, false, `${id} kept when --local-surface=off`);
  } finally {
    sandbox.cleanup();
  }
});

test("--local-surface=on trims even with a cloud default (the picker-local lever)", () => {
  const sandbox = createHostSandbox({ stubOllama: false });
  try {
    const cfgPath = seedConfig(sandbox.root, { model: "anthropic/claude-sonnet-4-6" });
    const r = runSync(sandbox.env, ["--local-surface=on"]);
    assert.equal(r.status, 0, `sync failed: ${r.stderr}`);
    const mcp = mcpOf(cfgPath);
    for (const id of HEAVY) assert.equal(mcp[id]?.enabled, false, `${id} trimmed when --local-surface=on`);
    assert.notEqual(mcp["construct-mcp"]?.enabled, false, "construct-mcp stays enabled");
  } finally {
    sandbox.cleanup();
  }
});

test("a local default model trims the heavy externals", () => {
  const sandbox = createHostSandbox({ stubOllama: false });
  try {
    const cfgPath = seedConfig(sandbox.root, { model: "ollama/qwen3-coder:32k" });
    const r = runSync(sandbox.env);
    assert.equal(r.status, 0, `sync failed: ${r.stderr}`);
    const mcp = mcpOf(cfgPath);
    for (const id of HEAVY) assert.equal(mcp[id]?.enabled, false, `${id} trimmed for a local default`);
  } finally {
    sandbox.cleanup();
  }
});
