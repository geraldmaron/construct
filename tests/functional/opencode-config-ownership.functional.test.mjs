/**
 * tests/functional/opencode-config-ownership.functional.test.mjs
 *
 * Asserts the ownership boundary between Construct-managed and user-personal
 * keys in the GLOBAL opencode config. Spawns the real sync-specialists.mjs into
 * an isolated tmp HOME seeded with a user-personal global config, runs
 * `--global`, and verifies that Construct-managed keys are emitted correctly
 * (scoped bash permission, real attribution headers with no `__placeholder__`,
 * an env-ref github token rather than a plaintext secret, and a seeded
 * small_model) while every user-personal key (model, share, autoupdate, a user
 * agent, user openrouter models) survives byte-for-byte. A second run proves the
 * small_model seed never overrides a value the user has set. The host binary is
 * never executed. See docs/concepts/opencode-config-ownership.md.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SYNC_SCRIPT = join(REPO_ROOT, "scripts", "sync-specialists.mjs");

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
  return { sandbox, cfgPath, cleanup() { rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
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

    const ghAuth = out.mcp?.github?.headers?.Authorization;
    assert.equal(ghAuth, "Bearer {env:GITHUB_TOKEN}");
    assert.ok(!/gh[oprs]_/.test(ghAuth ?? ""), "no plaintext github token may be written");

    assert.equal(out.small_model, "anthropic/claude-haiku-4-5-20251001", "small_model seeded when absent");

    assert.equal(out.model, "anthropic/claude-opus-4-6", "user model preserved");
    assert.equal(out.share, "disabled", "user share preserved");
    assert.equal(out.autoupdate, false, "user autoupdate preserved");
    assert.ok(out.agent?.myhelper, "user agent preserved");
    assert.ok(out.provider?.openrouter?.models?.["my/custom-model:free"], "user openrouter model preserved");
  } finally {
    env.cleanup();
  }
});

test("small_model seed never overrides a user-set value", () => {
  const seeded = { ...SEED, small_model: "anthropic/claude-sonnet-4-6" };
  const env = seededHome(seeded);
  try {
    const res = runGlobalSync(env.sandbox);
    assert.equal(res.status, 0, `sync failed: ${(res.stderr || "").slice(-400)}`);
    const out = readJson(env.cfgPath);
    assert.equal(out.small_model, "anthropic/claude-sonnet-4-6", "user small_model must be preserved");
  } finally {
    env.cleanup();
  }
});
