#!/usr/bin/env node
/**
 * hooks/repo-gate.mjs — runs the repo's own gate at commit time, so a violation
 * is surfaced where it was authored instead of by CI after the push.
 *
 * This exists because main went red at cddf718: a glossary violation shipped in
 * bf4f4c8 and nothing local caught it, because nothing local ran. CI was the
 * first gate and it runs after the push, so the repo spent a stretch with an
 * unreadable signal — and commitment 16 makes an unreadable signal the drift
 * worth catching, not a nuisance to wait out.
 *
 * IT WARNS AND NEVER BLOCKS. That is Phase 0's "minimal fail-open hook set", and
 * the reason is the predecessor: a crashing hook there wedged every tool call in
 * a session, which taught everyone to disable hooks, which left the repo with no
 * gate at all. A gate people turn off is worth less than a gate that only talks.
 * The exit code is 0 on every path below, including the paths where this script
 * itself cannot run — see the catch around the whole thing.
 *
 * It runs the npm scripts rather than the underlying tools on purpose. CI runs
 * `npm run lint` and `npm run typecheck`; a hook that ran tsc directly with its
 * own flags would drift from CI silently and start disagreeing with the thing it
 * is meant to predict.
 *
 * KNOWN IMPRECISION, stated rather than hidden: these check the working tree,
 * not the staged index. A partially staged commit can pass here and still fail
 * CI. Checking the index properly means materializing it somewhere and building
 * that, which costs more than it saves at this size — the common case is a whole
 * file staged, and for that the two agree.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { recordHookOutcome } from './hook-health.mjs';

const CHECKS = ['lint', 'typecheck'];

const RECONCILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'reconcile-tracker.mjs');

/**
 * Run one npm script. Returns what happened, and never throws — a check that
 * could not be started is a different outcome from a check that failed, and
 * collapsing the two would report a missing toolchain as a code defect.
 */
function runCheck(name) {
  const result = spawnSync('npm', ['run', '--silent', name], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) return { name, ran: false, passed: false, output: result.error.message };
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return { name, ran: true, passed: result.status === 0, output };
}

try {
  const results = CHECKS.map(runCheck);
  const failed = results.filter((r) => r.ran && !r.passed);
  const unrunnable = results.filter((r) => !r.ran);

  if (unrunnable.length > 0) {
    process.stderr.write(
      `repo-gate: could not run ${unrunnable.map((r) => r.name).join(', ')} — committing anyway\n`,
    );
  }

  for (const check of failed) {
    process.stderr.write(`\nrepo-gate: npm run ${check.name} FAILED\n`);
    if (check.output) process.stderr.write(`${check.output}\n`);
  }

  if (failed.length > 0) {
    process.stderr.write(
      `\nrepo-gate: this commit will turn CI red. Nothing is blocked — fix it before you push.\n\n`,
    );
  }

  // The reconciliation ritual, run rather than remembered (construct-fnn). It
  // is --quiet, so it says nothing when the tracker and the repo agree; a
  // check that speaks on every commit is a check people learn to scroll past.
  // Its own exit code is ignored on purpose — drift is a thing to read, not a
  // reason to interrupt a commit, and this hook blocks nothing regardless.
  const reconcile = spawnSync('node', [RECONCILE, '--quiet'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!reconcile.error && reconcile.stdout?.trim()) {
    process.stderr.write(`${reconcile.stdout}`);
  }

  // `ok` here means the gate itself worked, not that the code passed. A run of
  // red commits says something about the code; recording it as a hook failure
  // would eventually mark this hook unhealthy for doing its job correctly.
  recordHookOutcome('repo-gate', unrunnable.length === 0);
} catch (error) {
  process.stderr.write(`repo-gate: skipped (${error?.message ?? error})\n`);
}

process.exit(0);
