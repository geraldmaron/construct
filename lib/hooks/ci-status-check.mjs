#!/usr/bin/env node
/**
 * lib/hooks/ci-status-check.mjs — UserPromptSubmit hook: inject remote CI status into agent context.
 *
 * Queries `gh run list --branch=<current> --limit=1` once per user prompt and,
 * if the last run on the current branch failed, prints a stderr line that the
 * agent will see in its next observation. Without this, an agent has no way
 * to know remote CI is red without explicitly running gh — which means failed
 * jobs go unnoticed until the user catches them. Non-blocking.
 *
 * Cached on disk for 60s so frequent prompts don't spam the gh API.
 * Skipped silently if gh is not installed, not authenticated, or the dir is
 * not a git repo.
 *
 * @p95ms 4000
 * @maxBlockingScope none (UserPromptSubmit, non-blocking)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const CACHE_PATH = join(homedir(), '.cx', 'ci-status-cache.json');
const CACHE_TTL_MS = 60_000;

let cwd = process.cwd();
try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (input?.cwd) cwd = input.cwd;
} catch {}

function safeExec(cmd, opts = {}) {
  try { return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000, ...opts }).toString().trim(); }
  catch { return null; }
}

const branch = safeExec('git branch --show-current');
if (!branch) process.exit(0);

const cacheKey = `${cwd}::${branch}`;
let cache = {};
try { cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8')); } catch {}
const cached = cache[cacheKey];
const now = Date.now();

let conclusion = null;
let runId = null;
let runUrl = null;

if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
  conclusion = cached.conclusion;
  runId = cached.runId;
  runUrl = cached.runUrl;
} else {
  const json = safeExec(
    `gh run list --branch=${JSON.stringify(branch)} --limit=1 --json conclusion,databaseId,url`,
    { timeout: 4000 },
  );
  if (!json) process.exit(0);
  try {
    const [run] = JSON.parse(json);
    if (run) {
      conclusion = run.conclusion;
      runId = run.databaseId;
      runUrl = run.url;
      cache[cacheKey] = { conclusion, runId, runUrl, fetchedAt: now };
      try {
        mkdirSync(dirname(CACHE_PATH), { recursive: true });
        writeFileSync(CACHE_PATH, JSON.stringify(cache));
      } catch {}
    }
  } catch {}
}

if (conclusion === 'failure') {
  process.stderr.write(
    `[ci] Last CI run on branch '${branch}' FAILED (run ${runId}).\n  ${runUrl || ''}\n  Investigate with: gh run view ${runId} --log-failed\n  Do not stop the session until the failure is fixed or explicitly acknowledged (CONSTRUCT_STOP_OK_RED_CI=1).\n`,
  );
}

process.exit(0);
