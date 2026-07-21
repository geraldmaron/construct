/**
 * opencode-fewshot-prompt.functional.test.mjs — bead construct-c16l.
 *
 * The OpenCode construct orchestrator runs on native subagent routing, so it gets
 * the tool-bound micro-prompt (not the static roster). Small local models call
 * tools far more reliably with a worked example, so the micro-prompt carries a
 * compact few-shot orchestration_policy call. This asserts the example lands in
 * the synced agent and the prompt stays within the word cap (no --force needed),
 * in a sterile sandbox with zero real-config drift.
 */
import test from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHostSandbox, fingerprintRealConfigs, assertRealConfigsUnchanged } from "../helpers/sterile-host-env.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

test("opencode construct micro-prompt carries the few-shot example, within the word cap", () => {
  const before = fingerprintRealConfigs();
  const sandbox = createHostSandbox({ stubOllama: false });
  try {
    const dir = join(sandbox.root, ".config", "opencode");
    mkdirSync(dir, { recursive: true });
    const cfgPath = join(dir, "opencode.json");
    writeFileSync(cfgPath, JSON.stringify({ $schema: "https://opencode.ai/config.json", model: "ollama/qwen3-coder:32k", mcp: {} }));
    mkdirSync(join(sandbox.root, ".claude", "agents"), { recursive: true });
    writeFileSync(join(sandbox.root, ".claude", "settings.json"), JSON.stringify({ mcpServers: {} }));

    // CONSTRUCT_HOME_OVERRIDE pinned alongside the sandboxed HOME: lib/paths.mjs's
    // homeDir()/constructDir() check CONSTRUCT_HOME_OVERRIDE first, so any state-root
    // read (ADR-0066: lib/state-root.mjs) inside this subprocess resolves under
    // the sandbox rather than falling back to a HOME-propagation assumption.
    // No CONSTRUCT_TOOLKIT_DIR: sync-worker-profiles.mjs derives its own root from
    // import.meta.dirname and self-populates CONSTRUCT_TOOLKIT_DIR from it when
    // unset; supplying repoRoot here would also feed constructDir() and
    // redirect the state root into the repo instead of the sandbox above.
    // No CONSTRUCT_SYNC_FORCE: an over-cap prompt would exit non-zero here.
    const r = spawnSync(process.execPath, [join(repoRoot, "scripts", "sync-worker-profiles.mjs"), "--global"], {
      env: { ...sandbox.env, CONSTRUCT_HOME_OVERRIDE: sandbox.root, CONSTRUCT_SYNC_HOSTS: "opencode" },
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(r.status, 0, `sync must pass the word cap without --force: ${r.stderr}`);

    const prompt = JSON.parse(readFileSync(cfgPath, "utf8")).agent?.construct?.prompt || "";
    assert.match(prompt, /construct-mcp_orchestration_policy/, "micro-prompt names the OpenCode orchestration tool");
    assert.match(prompt, /construct-mcp_orchestration_run/, "micro-prompt names the OpenCode execution tool");
    assert.match(prompt, /"request": "add rate limiting to the API"/, "few-shot uses the real orchestration_policy argument name");
    assert.match(prompt, /add rate limiting to the API/, "micro-prompt carries the worked few-shot example");
    assert.doesNotMatch(prompt, /Available specialist agents:/, "native-subagent host gets the micro-prompt, not the roster");

    assertRealConfigsUnchanged(before);
  } finally {
    sandbox.cleanup();
  }
});
