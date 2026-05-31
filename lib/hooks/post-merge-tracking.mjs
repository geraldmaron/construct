#!/usr/bin/env node
/**
 * lib/hooks/post-merge-tracking.mjs — close beads referenced by a merged PR.
 *
 * Runs as a PostToolUse hook on Bash. Watches for `gh pr merge <N>` (or
 * `gh pr merge --auto`) invocations that exited successfully; parses the
 * PR body via `gh pr view <N> --json body`; extracts every `Refs:` /
 * `Closes:` / `Fixes:` line that names a `construct-XXX` bead; closes each
 * still-open bead with reason `Merged via PR #N (<sha>)`. Idempotent on
 * beads already closed.
 *
 * The PR-body parse is the source of truth — not the merge commit subject
 * — because the bundle PR pattern stores the bead refs in the body's
 * "Beads issue" section and the squash-merge subject often drops them.
 *
 * Best-effort. Exits 0 on any parse or shell failure so the surrounding
 * tool call is never affected. Stderr lines are advisory; the actual
 * outcome is the `bd close` state, which is what the next Stop hook's
 * tracking refresh will read.
 *
 * @lifecycle PostToolUse
 * @matcher  Bash
 * @p95ms 3000
 * @maxBlockingScope none (PostToolUse, non-blocking)
 * @exits 0 = pass
 */

import { spawnSync } from 'node:child_process';
import { readHookInput } from './_lib/input.mjs';
import { logHookFailure } from './_lib/log.mjs';

const input = readHookInput();
const command = input?.tool_input?.command || input?.command || '';
const exitCode = input?.tool_response?.exit_code ?? input?.tool_response?.exitCode;

const ghPrMergeMatch = /\bgh\s+pr\s+merge\b(?:\s+(\d+))?/.exec(command);
if (!ghPrMergeMatch) process.exit(0);
if (exitCode !== undefined && exitCode !== 0) process.exit(0);

const cwd = input?.cwd || process.cwd();
const prNumber = await resolvePrNumber(ghPrMergeMatch[1], cwd);
if (!prNumber) process.exit(0);

try {
  const { closeBeadsFromPrRefs } = await import('../tracking-surfaces.mjs');
  const mergeCommitSha = readMergeCommitSha(cwd);
  const result = await closeBeadsFromPrRefs({ prNumber, mergeCommitSha, cwd });
  if (result?.closed?.length > 0) {
    process.stderr.write(`[post-merge-tracking] closed beads: ${result.closed.join(', ')}\n`);
  }
  if (result?.errors?.length > 0) {
    process.stderr.write(`[post-merge-tracking] failed to close: ${result.errors.map((e) => e.id).join(', ')}\n`);
  }
} catch (err) {
  logHookFailure({ hook: 'post-merge-tracking', err, phase: 'close' });
}

process.exit(0);

async function resolvePrNumber(captured, cwd) {
  if (captured) return captured;
  // Bare `gh pr merge --auto` / `gh pr merge -s` invocations omit the PR
  // number. Resolve via the most recent merge commit subject, which `gh`
  // standardly tails with `(#N)`.
  try {
    const lastLog = spawnSync('git', ['log', '-1', '--pretty=format:%s'], { cwd, encoding: 'utf8', timeout: 2000 });
    if (lastLog.status !== 0) return null;
    const m = /#(\d+)/.exec(lastLog.stdout);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function readMergeCommitSha(cwd) {
  try {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', timeout: 2000 });
    return result.status === 0 ? result.stdout.trim() : '';
  } catch {
    return '';
  }
}
