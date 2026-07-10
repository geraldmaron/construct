/**
 * tests/helpers/sterile-env.mjs — Read-hermetic spawn/process envs for functional tests.
 *
 * Test hermeticity was write-guarded (tmpdir roots, HOME redirection) but not
 * read-guarded: building a spawn env from `{ ...process.env, ...overrides }`
 * lets a developer machine's CX_MODEL_*, provider keys, WEB_SEARCH_URL, and
 * CX_USER_ENV_PATH leak into a "sterile" child, and lib/providers/secret-resolver.mjs
 * can walk file/rc tiers and fire a real `op read` (a real desktop-app biometric
 * prompt) mid-test. sterileSpawnEnv() builds the env from an explicit allowlist
 * instead: nothing not named here reaches the child, HOME/CX_HOME_OVERRIDE are
 * pinned to a fresh mkdtemp root, and provider-key / model-tier / op-adjacent
 * vars are never inherited by construction — a caller must opt them back in
 * through `overrides`.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { rmTmpDir } from "./cleanup.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Builds a read-hermetic env object for a spawned child (child_process.spawn/
 * spawnSync, StdioClientTransport) or for a same-process caller that accepts an
 * isolated `env` option. Only OS-level vars a subprocess genuinely needs are
 * allowlisted; HOME/XDG are pinned to a fresh mkdtemp root each call so
 * ~/.env, ~/.construct/config.env, and any real op:// reference can never be
 * read. `overrides` is applied last and wins, so a suite can carry a specific
 * fake-but-present key or a pinned MODEL id without reopening the allowlist.
 *
 * @param {object} [overrides]
 * @returns {object} env
 */
export function sterileSpawnEnv(overrides = {}) {
  const home = overrides.HOME || mkdtempSync(join(tmpdir(), "construct-sterile-"));
  return {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR || tmpdir(),
    LANG: process.env.LANG || "en_US.UTF-8",
    HOME: home,
    USERPROFILE: home,
    CX_HOME_OVERRIDE: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_RUNTIME_DIR: join(home, "run"),
    ...overrides,
  };
}

/**
 * Writes a fake `op` binary that logs every `op read` invocation to a file and
 * returns a fixed canary value, mirroring the pattern already proven in
 * tests/functional/secret-resolver-real-op.functional.test.mjs. Prepend
 * `binDir` onto a sterile env's PATH to make it the first `op` resolved, then
 * assert the log stays empty to prove a hermetic layer never shells out to a
 * real 1Password read.
 *
 * @param {string} root - directory to create bin/ and the log file under.
 * @returns {{ binDir: string, logPath: string }}
 */
export function createOpStub(root) {
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const logPath = join(root, "op-reads.log");
  writeFileSync(logPath, "");

  const opBin = join(binDir, "op");
  const opScript = [
    "#!/usr/bin/env node",
    'const fs = require("node:fs");',
    "const args = process.argv.slice(2);",
    'if (args[0] === "read") {',
    "  fs.appendFileSync(process.env.OP_READ_LOG, \"read\\n\");",
    '  process.stdout.write("sterile-canary-not-a-real-secret");',
    "  process.exit(0);",
    "}",
    "process.exit(0);",
  ].join("\n");
  writeFileSync(opBin, opScript);
  chmodSync(opBin, 0o755);

  return { binDir, logPath };
}

/**
 * Creates a sterile test environment: a fresh Git repo plus a `run()` helper
 * that spawns commands through sterileSpawnEnv() rather than inheriting the
 * ambient process env.
 * @param {object} options
 * @param {string} options.prefix - Prefix for the temp directory.
 * @param {object} options.env - Environment variable overrides.
 * @returns {object} { path, cleanup, run }
 */
export function createSterileEnv({ prefix = "construct-test-", env = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), prefix));

  spawnSync("git", ["init"], { cwd: root });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  spawnSync("git", ["config", "user.name", "Test User"], { cwd: root });

  const cleanup = () => {
    try {
      rmTmpDir(root);
    } catch (e) {
      console.error(`Cleanup failed for ${root}: ${e.message}`);
    }
  };

  const run = (cmd, args = [], options = {}) => {
    const sterileEnv = sterileSpawnEnv({
      HOME: root,
      USERPROFILE: root,
      CX_HOME_OVERRIDE: root,
      CX_TOOLKIT_DIR: process.cwd(),
      ...env,
    });

    return spawnSync(cmd, args, {
      cwd: root,
      env: sterileEnv,
      encoding: "utf8",
      ...options,
    });
  };

  return { path: root, cleanup, run };
}

/**
 * Evaluates the quality of a test outcome using a rubric.
 * Returns a score between 0.0 and 1.0.
 */
export async function evaluateOutcome(output, rubric) {
  // TODO (geraldmaron): Implement cx-evaluator logic or LLM-as-a-judge call.
  // A basic rule-based heuristic stands in for the boilerplate.
  let score = 0;
  let totalWeight = 0;

  for (const [criterion, { weight, match }] of Object.entries(rubric)) {
    totalWeight += weight;
    if (match.test(output)) {
      score += weight;
    }
  }

  return totalWeight > 0 ? score / totalWeight : 1.0;
}
