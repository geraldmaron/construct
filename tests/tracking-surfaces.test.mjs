/**
 * tests/tracking-surfaces.test.mjs — unit coverage for lib/tracking-surfaces.mjs.
 *
 * Asserts the four exported functions behave at the right level of
 * granularity:
 *
 *   - `refreshContextMd` rewrites only the managed sections, preserves
 *     non-managed content, stamps `.cx/context.json` with counts.
 *   - `syncPlanFile` is a thin wrapper around the existing beads-automation
 *     `syncPlanWithBeads` and reports {ok, changed}.
 *   - `archivePlanIfLanded` no-ops when beads remain open, when the plan is
 *     recently touched, or when no plan refs exist; archives + resets when
 *     all referenced beads are closed and the plan has been idle ≥1h.
 *   - `closeBeadsFromPrRefs` parses `Refs:` / `Closes:` / `Fixes:` lines
 *     from a PR body, closes open beads, skips already-closed, and reports
 *     errors without throwing.
 *
 * `bd` and `gh` are stubbed via PATH shims so the tests run without the
 * real binaries.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  archivePlanIfLanded,
  closeBeadsFromPrRefs,
  refreshContextMd,
  syncPlanFile,
} from '../lib/tracking-surfaces.mjs';

let rootDir;
let shimDir;
let savedPath;

function makeShim(name, script) {
  const path = join(shimDir, name);
  writeFileSync(path, `#!/usr/bin/env bash\n${script}\n`, { mode: 0o755 });
}

function seedContextMd(initialBody) {
  mkdirSync(join(rootDir, '.construct'), { recursive: true });
  writeFileSync(join(rootDir, '.construct', 'context.md'), initialBody, 'utf8');
  writeFileSync(join(rootDir, '.construct', 'context.json'), JSON.stringify({ format: 'json' }), 'utf8');
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'tracking-surfaces-'));
  shimDir = mkdtempSync(join(tmpdir(), 'tracking-shims-'));
  savedPath = process.env.PATH;
  process.env.PATH = `${shimDir}:${savedPath}`;

  // Initialize a git repo so collectRecentCommits returns deterministic output.
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: rootDir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: rootDir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: rootDir });
});

afterEach(() => {
  process.env.PATH = savedPath;
  rmSync(rootDir, { recursive: true, force: true });
  rmSync(shimDir, { recursive: true, force: true });
});

// ── refreshContextMd ────────────────────────────────────────────────────────

test('refreshContextMd preserves user-authored sections outside the managed set', async () => {
  makeShim('bd', 'if [[ "$1" == "list" ]]; then echo "[]"; fi');
  seedContextMd(`# context

## Active Work

_None in progress._

## Recent Decisions

_No recent decisions captured._

## Architecture Notes

_No new architecture notes._

## Open Questions

- preserved Q1
- preserved Q2

## Hand-curated section

This is user content; refresh must not touch it.
`);

  const result = await refreshContextMd({ rootDir });
  assert.equal(result.ok, true);

  const after = readFileSync(join(rootDir, '.construct', 'context.md'), 'utf8');
  assert.match(after, /## Hand-curated section\n\nThis is user content; refresh must not touch it\./);
  assert.match(after, /preserved Q1/);
  assert.match(after, /preserved Q2/);
});

test('refreshContextMd populates Active Work from in_progress beads', async () => {
  makeShim('bd', `
if [[ "$1" == "list" && "$3" == "in_progress" ]]; then
  echo '[{"id":"construct-abc","title":"alpha","status":"in_progress"},{"id":"construct-def","title":"beta","status":"in_progress"}]'
  exit 0
fi
echo "[]"
`);
  seedContextMd(`# context\n\n## Active Work\n\n_None in progress._\n\n## Recent Decisions\n\n_No recent decisions captured._\n\n## Architecture Notes\n\n_No new architecture notes._\n\n## Open Questions\n\n- existing\n`);

  await refreshContextMd({ rootDir });
  const after = readFileSync(join(rootDir, '.construct', 'context.md'), 'utf8');
  assert.match(after, /\*\*construct-abc\*\* · alpha/);
  assert.match(after, /\*\*construct-def\*\* · beta/);
});

test('refreshContextMd stamps lastRefreshAt and counts in context.json', async () => {
  makeShim('bd', 'echo "[]"');
  seedContextMd(`# context\n\n## Active Work\n\n## Recent Decisions\n\n## Architecture Notes\n\n## Open Questions\n\n- q\n`);

  const now = new Date('2026-06-01T12:00:00.000Z');
  await refreshContextMd({ rootDir, now });

  const json = JSON.parse(readFileSync(join(rootDir, '.construct', 'context.json'), 'utf8'));
  assert.equal(json.lastRefreshAt, '2026-06-01T12:00:00.000Z');
  assert.ok(Array.isArray(json.activeWork));
  assert.ok(Array.isArray(json.recentDecisions));
  assert.ok(Array.isArray(json.architectureNotes));
});

test('refreshContextMd no-ops cleanly when .cx/context.md is missing', async () => {
  const result = await refreshContextMd({ rootDir });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-context-md');
});

// ── syncPlanFile ────────────────────────────────────────────────────────────

test('syncPlanFile no-ops cleanly when plan.md is absent', async () => {
  const result = await syncPlanFile({ rootDir });
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
});

// ── archivePlanIfLanded ─────────────────────────────────────────────────────

test('archivePlanIfLanded refuses to archive a plan that was touched in the last hour', async () => {
  makeShim('bd', `if [[ "$1" == "show" ]]; then echo '{"status":"closed"}'; fi`);
  const planPath = join(rootDir, 'plan.md');
  writeFileSync(planPath, '# plan\n\n- construct-aaa: done\n');

  const result = await archivePlanIfLanded({ rootDir });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'plan-recently-touched');
  assert.ok(existsSync(planPath), 'plan must survive when recently touched');
});

test('archivePlanIfLanded refuses to archive when any referenced bead is still open', async () => {
  makeShim('bd', `
if [[ "$1" == "show" && "$2" == "construct-bbb" ]]; then echo '{"status":"closed"}'; fi
if [[ "$1" == "show" && "$2" == "construct-ccc" ]]; then echo '{"status":"in_progress"}'; fi
`);
  const planPath = join(rootDir, 'plan.md');
  writeFileSync(planPath, '# plan\n\n- construct-bbb\n- construct-ccc\n');
  const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
  utimesSync(planPath, twoHoursAgo, twoHoursAgo);

  const result = await archivePlanIfLanded({ rootDir });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'beads-still-open');
  assert.ok(existsSync(planPath));
});

test('archivePlanIfLanded archives + resets when every referenced bead is closed and plan is idle', async () => {
  makeShim('bd', `if [[ "$1" == "show" ]]; then echo '{"status":"closed"}'; fi`);
  const planPath = join(rootDir, 'plan.md');
  const originalBody = '# active plan\n\nT1: construct-ddd ✓\nT2: construct-eee ✓\n';
  writeFileSync(planPath, originalBody);
  const now = new Date('2026-06-02T15:00:00.000Z');
  // Base the plan's mtime on the fixed `now`, not real Date.now(): the idle
  // check is `now - mtime < 1h`, so deriving mtime from wall-clock time made the
  // test fail whenever real UTC time advanced past the fixed `now` window.
  const twoHoursAgo = (now.getTime() - 2 * 60 * 60 * 1000) / 1000;
  utimesSync(planPath, twoHoursAgo, twoHoursAgo);

  const result = await archivePlanIfLanded({ rootDir, now });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.deepEqual(result.beadsClosed.sort(), ['construct-ddd', 'construct-eee']);

  const archived = readFileSync(result.archivePath, 'utf8');
  assert.match(archived, /^# Landed plan — 2026-06-02/);
  assert.match(archived, /construct-ddd/);
  assert.match(archived, /T1: construct-ddd/);

  const reset = readFileSync(planPath, 'utf8');
  assert.doesNotMatch(reset, /construct-ddd/);
  assert.match(reset, /plan\.md/);
});

// ── closeBeadsFromPrRefs ────────────────────────────────────────────────────

test('closeBeadsFromPrRefs parses Refs / Closes / Fixes lines and closes open beads', async () => {
  const callLog = join(rootDir, 'bd-calls.log');
  writeFileSync(callLog, '');
  makeShim('gh', `
cat <<'JSON'
{"body":"## Beads issue\\n\\nRefs: construct-aaa, construct-bbb\\nCloses: construct-ccc\\n\\nFixes #999"}
JSON
`);
  makeShim('bd', `
echo "$@" >> "${callLog}"
if [[ "$1" == "show" && "$2" == "construct-aaa" ]]; then echo '{"status":"open"}'; exit 0; fi
if [[ "$1" == "show" && "$2" == "construct-bbb" ]]; then echo '{"status":"in_progress"}'; exit 0; fi
if [[ "$1" == "show" && "$2" == "construct-ccc" ]]; then echo '{"status":"closed"}'; exit 0; fi
if [[ "$1" == "close" ]]; then exit 0; fi
echo "{}"
`);

  const result = await closeBeadsFromPrRefs({ prNumber: 42, mergeCommitSha: 'abcdef1234567890', cwd: rootDir });
  assert.equal(result.ok, true);
  assert.deepEqual(result.closed.sort(), ['construct-aaa', 'construct-bbb']);
  assert.deepEqual(result.skipped, ['construct-ccc']);
  assert.deepEqual(result.errors, []);

  const calls = readFileSync(callLog, 'utf8');
  assert.match(calls, /close construct-aaa --reason Merged via PR #42 \(abcdef123456\)/);
  assert.match(calls, /close construct-bbb --reason Merged via PR #42 \(abcdef123456\)/);
});

test('closeBeadsFromPrRefs reports errors per bead without throwing', async () => {
  makeShim('gh', `echo '{"body":"Refs: construct-fail"}'`);
  makeShim('bd', `
if [[ "$1" == "show" ]]; then echo '{"status":"open"}'; exit 0; fi
if [[ "$1" == "close" ]]; then echo "boom" >&2; exit 1; fi
`);

  const result = await closeBeadsFromPrRefs({ prNumber: 7, cwd: rootDir });
  assert.equal(result.ok, true);
  assert.deepEqual(result.closed, []);
  assert.deepEqual(result.skipped, []);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].id, 'construct-fail');
  assert.equal(result.errors[0].reason, 'bd-close-failed');
});

test('closeBeadsFromPrRefs returns ok:true with empty arrays when the PR body has no refs', async () => {
  makeShim('gh', `echo '{"body":"## Summary\\n\\nNothing references a bead here."}'`);
  makeShim('bd', `echo "{}"`);

  const result = await closeBeadsFromPrRefs({ prNumber: 11, cwd: rootDir });
  assert.equal(result.ok, true);
  assert.deepEqual(result.closed, []);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.errors, []);
});

test('closeBeadsFromPrRefs degrades cleanly when gh is unavailable', async () => {
  // No gh shim — spawnSync will fail to find the binary inside our PATH.
  process.env.PATH = `${shimDir}:/usr/bin:/bin`;

  const result = await closeBeadsFromPrRefs({ prNumber: 99, cwd: rootDir });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'pr-body-unavailable');
});
