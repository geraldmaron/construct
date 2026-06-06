#!/usr/bin/env node
/**
 * lib/hooks/ci-status-check.mjs — UserPromptSubmit hook: inject remote CI status into agent context.
 *
 * Reads a 60s on-disk cache of the last `gh run list` result for the current
 * branch and, when the cached conclusion is `failure`, emits a stderr line the
 * agent sees in its next observation. The synchronous fast path does no
 * subprocess spawning beyond a 50ms `git branch` probe — every cache miss is
 * served by detaching a background refresher (stale-while-revalidate), so the
 * UserPromptSubmit critical path stays under its 200ms budget regardless of
 * `gh` / network latency. Without this hook, an agent has no way to know
 * remote CI is red without explicitly running gh.
 *
 * The background refresher is `scripts/refresh-ci-status.mjs` invoked with
 * `--branch=<name> --cwd=<dir> --cache=<path>`; it inherits no stdio and
 * detaches so a slow `gh` invocation can't keep the hook process alive.
 * Skipped silently if gh is not installed, not authenticated, or the dir is
 * not a git repo.
 *
 * @p95ms 200
 * @maxBlockingScope none (UserPromptSubmit, non-blocking)
 *
 * @lifecycle UserPromptSubmit
 * @matcher  *
 * @exits 0 = pass
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE_PATH = join(homedir(), '.cx', 'ci-status-cache.json');
const CACHE_TTL_MS = 60_000;
const HERE = dirname(fileURLToPath(import.meta.url));
const REFRESHER = resolve(HERE, '..', '..', 'scripts', 'refresh-ci-status.mjs');

let cwd = process.cwd();
try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (input?.cwd) cwd = input.cwd;
} catch {}

// 50ms hard timeout on `git branch --show-current`: bounded enough that even
// a hung git invocation cannot blow the 200ms hook budget.

function safeGitBranch() {
  try {
    return execSync('git branch --show-current', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 50,
    }).toString().trim();
  } catch { return null; }
}

const branch = safeGitBranch();
if (!branch) process.exit(0);

const cacheKey = `${cwd}::${branch}`;
let cache = {};
try { cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8')); } catch {}
const cached = cache[cacheKey];
const now = Date.now();

// Stale-while-revalidate: serve any cached value (even stale) on the
// critical path, and detach a background refresher when the cache is stale
// or absent. The first prompt against a never-cached branch sees nothing;
// the second prompt (after the detached refresher has written) sees the
// real status. That tradeoff buys a flat ~50ms p95.

const isStale = !cached || (now - cached.fetchedAt) >= CACHE_TTL_MS;

if (isStale && existsSync(REFRESHER)) {
  try {
    const child = spawn(process.execPath, [
      REFRESHER,
      `--branch=${branch}`,
      `--cwd=${cwd}`,
      `--cache=${CACHE_PATH}`,
    ], {
      cwd,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {}
}

if (cached?.conclusion === 'failure') {
  process.stderr.write(
    `[ci] Last CI run on branch '${branch}' FAILED (run ${cached.runId}).\n  ${cached.runUrl || ''}\n  Investigate with: gh run view ${cached.runId} --log-failed\n  Do not stop the session until the failure is fixed or explicitly acknowledged (CONSTRUCT_STOP_OK_RED_CI=1).\n`,
  );
}

// First-prompt edge case: no cache exists yet AND we just kicked off the
// refresher. We still exit 0 (silent). On the next prompt, the cache will
// be populated and any failure surfaces.

if (!cached) {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    if (!existsSync(CACHE_PATH)) writeFileSync(CACHE_PATH, '{}');
  } catch {}
}

process.exit(0);
