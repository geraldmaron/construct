/**
 * tests/e2e/lib/sterile-env.mjs — isolated environment construction for a
 * scenario.
 *
 * Each scenario runs against a dedicated tmpdir tree with its own HOME and
 * CONSTRUCT_HOME_OVERRIDE, so neither the host machine's ~/.construct / ~/.cx state nor
 * its global installs leak into the observation, and nothing the scenario writes
 * escapes the sandbox. CONSTRUCT_DEV_PATH points the project launcher at the
 * repo under test, so the sweep exercises the local build rather than a
 * published package or a stale global.
 *
 * Layout under the scenario root:
 *   <root>/home/         isolated HOME (and CONSTRUCT_HOME_OVERRIDE) — ~/.construct, ~/.cx land here
 *   <root>/project/      the scenario's project dir (fixture target, git repo)
 *
 * On failure the caller preserves the root and prints its path; on success the
 * caller removes it. This module only builds the env and timing helpers — it
 * runs no commands itself.
 */

import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export function makeSterileEnv({ repoRoot, prefix }) {
  const root = mkdtempSync(join(os.tmpdir(), prefix));
  const home = join(root, 'home');
  const project = join(root, 'project');
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });

  // The sandbox keeps PATH (node, git, npm must resolve) but rebinds HOME and
  // CONSTRUCT_HOME_OVERRIDE so every ~ write lands inside the sandbox, and points the
  // launcher at the repo so the local build answers.
  const env = {
    ...process.env,
    HOME: home,
    CONSTRUCT_HOME_OVERRIDE: home,
    CONSTRUCT_DEV_PATH: repoRoot,
    CONSTRUCT_DISABLE_DOCKER: '1',
  };

  return { root, home, project, env, launcher: join(repoRoot, 'bin', 'construct') };
}

// A timed command capture: full stdout/stderr verbatim, exit code, wall-clock
// milliseconds, and a timeout flag. The unit Tier 1 reports for each install/
// init step.

export function timedRun({ bin, args, cwd, env, timeoutMs = 600_000, input = '' }) {
  const startedAt = process.hrtime.bigint();
  const res = spawnSync(bin, args, { cwd, env, encoding: 'utf8', timeout: timeoutMs, input });
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  return {
    argv: [bin, ...args],
    cwd,
    status: res.status,
    signal: res.signal,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    elapsedMs: Math.round(elapsedMs),
    timedOut: res.signal === 'SIGTERM' || res.error?.code === 'ETIMEDOUT',
    spawnError: res.error ? res.error.message : null,
  };
}

// git init plus a baseline commit so non-destructive scaffolding (marker blocks,
// .gitignore reconciliation) has a real working tree and history to act on.

export function gitInit({ cwd, env }) {
  const run = (args) => spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  run(['init', '-q']);
  run(['config', 'user.email', 'e2e@construct.test']);
  run(['config', 'user.name', 'Construct E2E']);
  return run(['rev-parse', '--is-inside-work-tree']).stdout.trim() === 'true';
}
