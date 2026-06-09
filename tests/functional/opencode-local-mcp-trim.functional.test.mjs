/**
 * opencode-local-mcp-trim.functional.test.mjs — bead construct-5b6u.
 *
 * When the default OpenCode model is local (ollama/…), Construct's sync must
 * disable the heavy external MCP servers (context7/github/memory/
 * sequential-thinking) in the GLOBAL opencode.json — the only lever that drops
 * their ~130 tool schemas from EVERY agent's request, including the built-in
 * Build/Plan agents the per-agent permission prune cannot reach. construct-mcp
 * stays enabled, and a cloud-model default keeps the full surface. Runs the real
 * sync binary in a sterile host sandbox and asserts zero real-config drift.
 */
import test from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHostSandbox, fingerprintRealConfigs, assertRealConfigsUnchanged } from "../helpers/sterile-host-env.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const HEAVY = ["context7", "github", "memory", "sequential-thinking"];

function seedConfig(home, model) {
  const dir = join(home, ".config", "opencode");
  mkdirSync(dir, { recursive: true });
  const mcp = { "construct-mcp": { type: "local", command: ["x"], enabled: true } };
  for (const id of HEAVY) mcp[id] = { type: "local", command: ["x"], enabled: true };
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json", model, mcp }, null, 2));
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

test("local-default opencode sync disables heavy MCP servers, keeps construct-mcp; cloud keeps full surface", () => {
  const before = fingerprintRealConfigs();
  const sandbox = createHostSandbox({ stubOllama: false });
  try {
    const cfgPath = seedConfig(sandbox.root, "ollama/qwen3-coder:32k");

    const local = runSync(sandbox.env);
    assert.equal(local.status, 0, `local sync failed: ${local.stderr}`);
    const afterLocal = JSON.parse(readFileSync(cfgPath, "utf8")).mcp;
    for (const id of HEAVY) assert.equal(afterLocal[id]?.enabled, false, `${id} must be disabled for a local default`);
    assert.notEqual(afterLocal["construct-mcp"]?.enabled, false, "construct-mcp must stay enabled");

    // Switching the default to a cloud model restores the full surface.
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    cfg.model = "anthropic/claude-sonnet-4-6";
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

    const cloud = runSync(sandbox.env);
    assert.equal(cloud.status, 0, `cloud sync failed: ${cloud.stderr}`);
    const afterCloud = JSON.parse(readFileSync(cfgPath, "utf8")).mcp;
    for (const id of HEAVY) assert.notEqual(afterCloud[id]?.enabled, false, `${id} must NOT be disabled for a cloud default`);

    assertRealConfigsUnchanged(before);
  } finally {
    sandbox.cleanup();
  }
});
