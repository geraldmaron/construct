/**
 * tests/functional/opencode-config-ownership.functional.test.mjs
 *
 * Asserts the ownership boundary between Construct-managed and user-personal
 * keys in the GLOBAL opencode config. Spawns the real sync-worker-profiles.mjs into
 * an isolated tmp HOME seeded with a user-personal global config, runs
 * `--global`, and verifies that Construct-managed keys are emitted correctly
 * (scoped bash permission and real attribution headers with no `__placeholder__`)
 * while every user-personal
 * key (share, autoupdate, a user agent, user openrouter models) survives
 * byte-for-byte. The host binary is never executed.
 * See docs/guides/concepts/opencode-config-ownership.md.
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
const SYNC_SCRIPT = join(REPO_ROOT, "scripts", "sync-worker-profiles.mjs");

const SEED = {
  $schema: "https://opencode.ai/config.json",
  model: "anthropic/claude-opus-4-6",
  share: "disabled",
  autoupdate: false,
  agent: { myhelper: { description: "user agent", mode: "subagent", prompt: "mine" } },
  provider: {
    openrouter: {
      npm: "@ai-sdk/openai-compatible",
      name: "OpenRouter",
      options: { baseURL: "https://openrouter.ai/api/v1", headers: {} },
      models: { "my/custom-model:free": { name: "My Custom Free Model" } },
    },
  },
  mcp: {},
};

function seededHome(seedConfig = SEED) {
  const sandbox = mkdtempSync(join(tmpdir(), "oc-ownership-"));
  const cfgPath = join(sandbox, ".config", "opencode", "opencode.json");
  mkdirSync(dirname(cfgPath), { recursive: true });
  writeFileSync(cfgPath, JSON.stringify(seedConfig, null, 2) + "\n");
  return { sandbox, cfgPath, cleanup() { rmTmpDir(sandbox); } };
}

function runGlobalSync(home) {
  const env = { ...process.env, HOME: home, CONSTRUCT_SKIP_POSTINSTALL: "1" };
  delete env.GITHUB_TOKEN;
  const res = spawnSync(process.execPath, [SYNC_SCRIPT, "--global"], {
    cwd: REPO_ROOT, encoding: "utf8", timeout: 90_000, env,
  });
  return res;
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

test("global sync emits Construct-managed keys correctly and preserves user-personal keys", () => {
  const env = seededHome();
  try {
    const res = runGlobalSync(env.sandbox);
    assert.equal(res.status, 0, `sync failed: ${(res.stderr || "").slice(-400)}`);
    const out = readJson(env.cfgPath);

    const bash = out.agent?.construct?.permission?.bash;
    assert.equal(typeof bash, "object", "construct bash permission must be a scoped map");
    assert.equal(bash["rm -rf *"], "deny");
    assert.equal(bash["git push *"], "ask");
    assert.equal(bash["*"], "allow");

    const headers = out.provider?.openrouter?.options?.headers ?? {};
    assert.equal(headers["HTTP-Referer"], "https://github.com/geraldmaron/construct");
    assert.equal(headers["X-Title"], "Construct");
    for (const v of Object.values(headers)) {
      assert.ok(!String(v).includes("__"), `unresolved placeholder leaked into header: ${v}`);
    }

    assert.ok(out.mcp?.["construct-mcp"], "construct MCP must be wired");
    assert.equal(out.mcp?.github, undefined, "github MCP must not be wired until explicitly installed");
    assert.equal(out.construct?.models, undefined, "Construct must not backfill model tiers");

    assert.equal(out.model, "anthropic/claude-opus-4-6", "user model preserved");
    assert.equal(out.share, "disabled", "user share preserved");
    assert.equal(out.autoupdate, false, "user autoupdate preserved");
    assert.ok(out.agent?.myhelper, "user agent preserved");
    assert.ok(out.provider?.openrouter?.models?.["my/custom-model:free"], "user openrouter model preserved");
  } finally {
    env.cleanup();
  }
});

test("global sync clears the legacy pinned OpenCode model and refreshes helper agents", () => {
  const env = seededHome({
    $schema: "https://opencode.ai/config.json",
    model: "openrouter/qwen/qwen3-coder:free",
    share: "disabled",
    autoupdate: false,
    agent: {
      title: { model: "ollama/qwen2.5-coder:7b-cx32k" },
      summary: { model: "ollama/qwen2.5-coder:7b-cx32k" },
      compaction: { model: "ollama/qwen2.5-coder:7b-cx32k" },
      myhelper: { description: "user agent", mode: "subagent", prompt: "mine" },
    },
    provider: {
      openrouter: {
        npm: "@ai-sdk/openai-compatible",
        name: "OpenRouter",
        options: { baseURL: "https://openrouter.ai/api/v1", headers: {} },
        models: { "my/custom-model:free": { name: "My Custom Free Model" } },
      },
    },
    mcp: {},
  });
  try {
    const res = runGlobalSync(env.sandbox);
    assert.equal(res.status, 0, `sync failed: ${(res.stderr || "").slice(-400)}`);
    const out = readJson(env.cfgPath);

    assert.equal(out.model, undefined, "legacy primary model pin should be removed");
    // Helper agents must carry NO absolute model pin at all: a pinned model made
    // compaction fail hard when the pinned provider had no key/credits, ignoring
    // the user's live model selection.
    assert.equal(out.agent?.title?.model, undefined, "title helper must not pin a model");
    assert.equal(out.agent?.summary?.model, undefined, "summary helper must not pin a model");
    assert.equal(out.agent?.compaction?.model, undefined, "compaction helper must not pin a model");
    assert.ok(out.agent?.myhelper, "user agent preserved");
  } finally {
    env.cleanup();
  }
});
