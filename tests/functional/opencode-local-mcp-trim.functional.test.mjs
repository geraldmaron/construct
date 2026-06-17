/**
 * opencode-local-mcp-trim.functional.test.mjs — bead construct-5b6u.
 *
 * OpenCode 1.15.4 has no per-session tool filter, so the heavy external MCP
 * servers (context7/github/memory/sequential-thinking/playwright) can only be
 * removed at sync time. Sync disables them in the GLOBAL opencode.json whenever
 * local Ollama models are present — a runtime model picker leaves the default
 * model unset, so keying off the default alone missed the common case (the
 * Build-agent overflow). construct-mcp stays enabled; a setup with no Ollama
 * models keeps the full surface; a manual enabled:true is preserved. Runs the
 * real sync binary in a sterile host sandbox and asserts zero real-config drift.
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
  // Realistic registered state: a server has no `enabled` field (absent =
  // enabled by default in OpenCode); a user re-enabling sets it true explicitly.
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

function runSync(env) {
  return spawnSync(process.execPath, [join(repoRoot, "scripts", "sync-specialists.mjs"), "--global"], {
    env: { ...env, CX_TOOLKIT_DIR: repoRoot, CONSTRUCT_SYNC_FORCE: "1", CONSTRUCT_SYNC_HOSTS: "opencode" },
    encoding: "utf8",
    timeout: 60_000,
  });
}
const mcpOf = (p) => JSON.parse(readFileSync(p, "utf8")).mcp;

test("ollama models registered (no default set) disables the heavy externals — the runtime-picker case", () => {
  const before = fingerprintRealConfigs();
  const sandbox = createHostSandbox({ stubOllama: false });
  try {
    const cfgPath = seedConfig(sandbox.root, { ollamaModels: { "qwen3-coder:32k": { name: "qwen3-coder:32k" } } });
    const r = runSync(sandbox.env);
    assert.equal(r.status, 0, `sync failed: ${r.stderr}`);
    const mcp = mcpOf(cfgPath);
    for (const id of HEAVY) assert.equal(mcp[id]?.enabled, false, `${id} disabled when local models present`);
    assert.notEqual(mcp["construct-mcp"]?.enabled, false, "construct-mcp stays enabled");
    assertRealConfigsUnchanged(before);
  } finally {
    sandbox.cleanup();
  }
});

test("no ollama models present keeps the full external surface", () => {
  // Stub an Ollama with no models so the system signal is false (the real
  // machine running the test may have models).
  const sandbox = createHostSandbox({ stubOllama: true, ollamaModels: [] });
  try {
    const cfgPath = seedConfig(sandbox.root, { model: "anthropic/claude-sonnet-4-6" });
    const r = runSync(sandbox.env);
    assert.equal(r.status, 0, `sync failed: ${r.stderr}`);
    const mcp = mcpOf(cfgPath);
    for (const id of HEAVY) assert.notEqual(mcp[id]?.enabled, false, `${id} NOT disabled without local models`);
  } finally {
    sandbox.cleanup();
  }
});

test("a manual enabled:true is preserved across sync (user re-enable wins)", () => {
  const sandbox = createHostSandbox({ stubOllama: false });
  try {
    const cfgPath = seedConfig(sandbox.root, { ollamaModels: { "qwen3-coder:32k": { name: "qwen3-coder:32k" } } });
    // User explicitly wants github back on.
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    cfg.mcp.github.enabled = true;
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

    const r = runSync(sandbox.env);
    assert.equal(r.status, 0, `sync failed: ${r.stderr}`);
    const mcp = mcpOf(cfgPath);
    assert.equal(mcp.github.enabled, true, "manual github re-enable is preserved");
    assert.equal(mcp.context7.enabled, false, "the rest stay disabled");
  } finally {
    sandbox.cleanup();
  }
});
