/**
 * tests/functional/opencode-stale-managed-reconcile.functional.test.mjs
 *
 * reconcileStaleManagedEntries wired into syncOpencode. Project
 * scope only writes core MCP ids into `.opencode/opencode.json`'s `mcp` map
 * (`PROJECT_DEFAULT_MCP_IDS`), so a managed-but-optional entry like `memory`
 * carrying a stale toolkit path is outside the sync-set loop and was never
 * revisited before this fix (the same gap, extended here to OpenCode).
 * Spawns the real sync-worker-profiles.mjs into an isolated tmp project + HOME,
 * seeds a stale `memory` entry in OpenCode's own `command`-array shape, and
 * asserts the real binary rewrites it in place, leaves an unmanaged entry
 * untouched, and is idempotent on a second run.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SYNC_SCRIPT = join(REPO_ROOT, "scripts", "sync-worker-profiles.mjs");

function makeEnv() {
  const sandbox = mkdtempSync(join(tmpdir(), "opencode-stale-reconcile-"));
  const HOME = join(sandbox, "HOME");
  const project = join(sandbox, "project");
  mkdirSync(HOME, { recursive: true });
  mkdirSync(project, { recursive: true });
  spawnSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: project });
  return { sandbox, HOME, project, cleanup() { rmTmpDir(sandbox); } };
}

function seedStaleOpencodeConfig(project) {
  const dir = join(project, ".opencode");
  mkdirSync(dir, { recursive: true });
  const config = {
    $schema: "https://opencode.ai/config.json",
    agent: {},
    mcp: {
      memory: {
        type: "local",
        command: ["node", "/old/checkout/lib/mcp/memory-bridge.mjs"],
        environment: { CONSTRUCT_MEMORY_BRIDGE_URL: "http://127.0.0.1:8765/" },
      },
      "my-tool": { type: "local", command: ["npx", "-y", "my-unrelated-tool"] },
    },
  };
  const configPath = join(dir, "opencode.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

function runSync(env) {
  return spawnSync(process.execPath, [SYNC_SCRIPT, "--project"], {
    cwd: env.project,
    encoding: "utf8",
    timeout: 90_000,
    env: { ...process.env, HOME: env.HOME, CONSTRUCT_SKIP_POSTINSTALL: "1", CONSTRUCT_SYNC_HOSTS: "opencode" },
  });
}

test("project sync rewrites a stale out-of-set memory entry in OpenCode config and leaves the unmanaged entry untouched", () => {
  const env = makeEnv();
  try {
    const configPath = seedStaleOpencodeConfig(env.project);
    const r = runSync(env);
    assert.equal(r.status, 0, r.stderr || r.stdout);

    const config = JSON.parse(readFileSync(configPath, "utf8"));
    assert.ok(Array.isArray(config.mcp.memory.command), "memory entry keeps OpenCode's command-array shape");
    assert.ok(
      !config.mcp.memory.command.some((a) => typeof a === "string" && a.includes("/old/checkout/")),
      "stale toolkit path was rewritten to the current checkout",
    );
    assert.ok(
      config.mcp.memory.command.some((a) => typeof a === "string" && a.includes(REPO_ROOT) && a.endsWith("memory-bridge.mjs")),
      "rewritten memory entry now points at this checkout's memory-bridge.mjs",
    );
    assert.deepEqual(
      config.mcp["my-tool"],
      { type: "local", command: ["npx", "-y", "my-unrelated-tool"] },
      "the unmanaged user entry is untouched",
    );
  } finally {
    env.cleanup();
  }
});

test("a second project sync run is idempotent — the reconciled memory entry is no longer stale", () => {
  const env = makeEnv();
  try {
    const configPath = seedStaleOpencodeConfig(env.project);
    const first = runSync(env);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const afterFirst = readFileSync(configPath, "utf8");

    const second = runSync(env);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    const afterSecond = readFileSync(configPath, "utf8");

    assert.equal(afterSecond, afterFirst, "a second sync run makes no further change to the reconciled entry");
  } finally {
    env.cleanup();
  }
});
