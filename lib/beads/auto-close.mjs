#!/usr/bin/env node
/**
 * lib/hooks/beads-auto-close.mjs — auto-close beads on merge.
 *
 * Scans the commit messages on the just-merged range for any
 * `closes construct-xxx` / `fixes construct-xxx` / `resolves construct-xxx`
 * references (case-insensitive). For each unique bead id found, runs
 * `bd close <id> --reason="Auto-closed on merge <sha>: <subject>"` so
 * the tracker matches reality without manual intervention.
 *
 * Invocation: the `.beads/hooks/post-merge` git hook shim runs this,
 * or `--range=<git-range>` triggers a standalone backfill.
 *
 * Exit codes:
 *   0   no closes referenced, or all closes succeeded
 *   1   one or more bd close calls failed
 *   2   could not parse git range / no bd CLI
 *
 * Idempotent: closing an already-closed bead is a no-op so re-running
 * the hook after a merge is safe.
 */

import { spawnSync } from 'node:child_process';
import { isMainModule } from '../roots.mjs';

const CLOSES_RE = /\b(?:closes?|close|fix(?:es)?|fixed|resolves?|resolved)\s+(construct-[a-z0-9]+)/gi;

export function parseClosesFromMessage(message) {
  if (!message) return [];
  const found = new Set();
  let match;
  CLOSES_RE.lastIndex = 0;
  while ((match = CLOSES_RE.exec(message)) !== null) {
    found.add(match[1].toLowerCase());
  }
  return [...found];
}

export function listCommitsInRange(range, { runner = spawnSync } = {}) {
  const result = runner('git', ['log', range, '--pretty=format:%H%x09%s%x09%B%x00'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split('\x00')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, subject, ...rest] = entry.split('\t');
      return { sha, subject, body: rest.join('\t') };
    });
}

export function collectAutoCloses(commits) {
  const closesById = new Map();
  for (const commit of commits) {
    const ids = parseClosesFromMessage(`${commit.subject}\n${commit.body}`);
    for (const id of ids) {
      if (!closesById.has(id)) closesById.set(id, []);
      closesById.get(id).push({ sha: commit.sha, subject: commit.subject });
    }
  }
  return closesById;
}

export function buildAutoCloseReason(commits) {
  const first = commits[0];
  if (!first) return 'Auto-closed on merge';
  const shortSha = first.sha.slice(0, 12);
  return `Auto-closed on merge ${shortSha}: ${first.subject}`;
}

/**
 * Drive the auto-close: list commits in the range, parse closes, invoke
 * `bd close` for each. Returns a summary the caller can log or test.
 */
export async function runAutoClose({ range, runner = spawnSync } = {}) {
  if (!range) return { ok: false, reason: 'no range', closed: [], failed: [] };

  const commits = listCommitsInRange(range, { runner });
  if (commits.length === 0) return { ok: true, closed: [], failed: [], commits: 0 };

  const closesById = collectAutoCloses(commits);
  if (closesById.size === 0) return { ok: true, closed: [], failed: [], commits: commits.length };

  const closed = [];
  const failed = [];
  for (const [id, refs] of closesById) {
    const reason = buildAutoCloseReason(refs);
    const result = runner('bd', ['close', id, `--reason=${reason}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status === 0) {
      closed.push({ id, sha: refs[0]?.sha, subject: refs[0]?.subject });
    } else {
      failed.push({
        id,
        exitCode: result.status,
        stderr: (result.stderr || '').slice(0, 500),
      });
    }
  }
  return { ok: failed.length === 0, closed, failed, commits: commits.length };
}

// CLI entry: read --range, run, print summary.
const invokedDirectly = isMainModule(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const rangeArg = args.find((a) => a.startsWith('--range='));
  // Default: every commit unique to the current branch that landed via the
  // current HEAD's range (post-merge sees ORIG_HEAD..HEAD typically).
  const range = rangeArg ? rangeArg.split('=')[1] : (process.env.BEADS_AUTO_CLOSE_RANGE || 'ORIG_HEAD..HEAD');
  const summary = await runAutoClose({ range });
  if (summary.closed.length > 0) {
    process.stdout.write(`[beads-auto-close] closed ${summary.closed.length} bead(s): ${summary.closed.map((c) => c.id).join(', ')}\n`);
  }
  if (summary.failed.length > 0) {
    for (const f of summary.failed) {
      process.stderr.write(`[beads-auto-close] failed ${f.id} (exit ${f.exitCode}): ${f.stderr}\n`);
    }
    process.exit(1);
  }
  process.exit(0);
}
