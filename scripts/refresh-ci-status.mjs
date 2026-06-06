#!/usr/bin/env node
/**
 * scripts/refresh-ci-status.mjs — detached background refresher for
 * `lib/hooks/ci-status-check.mjs`.
 *
 * Spawned with `--branch=<name> --cwd=<dir> --cache=<path>` from the
 * UserPromptSubmit hook when its on-disk cache is stale or absent. Runs
 * `gh run list` for the requested branch, writes the result to the cache
 * file under the key `<cwd>::<branch>`, and exits. Fails silently — the
 * hook tolerates an empty cache and never blocks on this script's
 * completion (it's spawned detached and unref'd).
 *
 * Lives in `scripts/` rather than `lib/hooks/` because it is not itself a
 * hook — Claude Code never invokes it directly.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const eq = a.indexOf('=');
      return eq === -1 ? [a.slice(2), 'true'] : [a.slice(2, eq), a.slice(eq + 1)];
    }),
);

const branch = args.branch;
const cwd = args.cwd || process.cwd();
const cachePath = args.cache;

if (!branch || !cachePath) process.exit(0);

function safeExec(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 8000,
      ...opts,
    }).toString().trim();
  } catch { return null; }
}

const json = safeExec(
  `gh run list --branch=${JSON.stringify(branch)} --limit=1 --json conclusion,databaseId,url`,
);
if (!json) process.exit(0);

let run;
try { [run] = JSON.parse(json); } catch { process.exit(0); }
if (!run) process.exit(0);

let cache = {};
try { cache = JSON.parse(readFileSync(cachePath, 'utf8')); } catch {}

cache[`${cwd}::${branch}`] = {
  conclusion: run.conclusion,
  runId: run.databaseId,
  runUrl: run.url,
  fetchedAt: Date.now(),
};

try {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache));
} catch {}

process.exit(0);
