/**
 * tests/oracle-invariants-closed-bead-sha.test.mjs — the `closed-bead-sha-reachable-
 * from-main-or-annotated` Layer 1 invariant: SHA extraction, unmerged-annotation
 * detection, and per-bead evaluation against a real (hermetic, tmpdir) git repo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  id,
  layer,
  extractCitedSha,
  hasUnmergedAnnotation,
  evaluateBead,
  check,
} from '../lib/oracle/invariants/closed-bead-sha-reachable.mjs';

function git(cwd, args) {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: cwd, USERPROFILE: cwd, GIT_CONFIG_GLOBAL: path.join(cwd, '.gitconfig-none') },
  });
  assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout.trim();
}

function makeRepo(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-invariant-sha-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  git(cwd, ['init', '-q', '-b', 'main']);
  git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'a\n');
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-q', '-m', 'base']);
  const baseSha = git(cwd, ['rev-parse', 'HEAD']);

  fs.writeFileSync(path.join(cwd, 'b.txt'), 'b\n');
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-q', '-m', 'main-tip']);

  git(cwd, ['checkout', '-q', '-b', 'feature', baseSha]);
  fs.writeFileSync(path.join(cwd, 'c.txt'), 'c\n');
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-q', '-m', 'unmerged-work']);
  const featureSha = git(cwd, ['rev-parse', 'HEAD']);

  git(cwd, ['checkout', '-q', 'main']);

  return { cwd, baseSha, featureSha };
}

test('invariant module exports id/layer per the registry contract', () => {
  assert.equal(id, 'closed-bead-sha-reachable-from-main-or-annotated');
  assert.equal(layer, 1);
});

test('extractCitedSha finds the first hex-shaped SHA in real observed close-reason text', () => {
  assert.equal(extractCitedSha('Fixed in deba1a90: approval-queue.mjs #persist() now uses temp-file-then-rename.'), 'deba1a90');
  assert.equal(extractCitedSha('Landed: e10f0c4d (merge dbf66bc5) — threat/abuse review doc on staging'), 'e10f0c4d');
  assert.equal(extractCitedSha('Landed on staging via commit f81f08f3, merged at HEAD 6e3d05be.'), 'f81f08f3');
});

test('extractCitedSha skips hyphen-joined identifiers that are not SHA citations (real observed false positives)', () => {
  assert.equal(
    extractCitedSha('tests/functional/regression-run-02158a157d53.functional.test.mjs pins the fixture'),
    null,
  );
  assert.equal(
    extractCitedSha('fast=claude-haiku-4-5-20251001); all resolve tier-default.'),
    null,
  );
  assert.equal(
    extractCitedSha('remove once o6t8.1 merges — done in 2dcc5cf9.'),
    '2dcc5cf9',
    'a real SHA elsewhere in the same reason is still found once the false positive is skipped',
  );
});

test('extractCitedSha skips an audit-event fingerprint (real observed false positive)', () => {
  assert.equal(
    extractCitedSha('Duplicate audit records (identical fingerprint 0833aee255ba0780) for a legitimate, merged edit.'),
    null,
  );
});

test('extractCitedSha returns null when no SHA-shaped token is present', () => {
  assert.equal(extractCitedSha('Closed as superseded, epic retired without a code change.'), null);
  assert.equal(extractCitedSha(''), null);
  assert.equal(extractCitedSha(undefined), null);
});

test('hasUnmergedAnnotation recognizes real precedent phrasing from this branch\'s bd history', () => {
  assert.equal(hasUnmergedAnnotation('verified NOT reachable from origin/main or origin/staging'), true);
  assert.equal(hasUnmergedAnnotation('Remains CLOSED per R1 disposition (acceptance genuinely met, just unmerged).'), true);
  assert.equal(hasUnmergedAnnotation('exist only on the unmerged, not-to-be-merged-as-is PR branch'), true);
  assert.equal(hasUnmergedAnnotation('Fixed in deba1a90: temp-file-then-rename persistence.'), false);
});

test('evaluateBead: a SHA that IS an ancestor of mainRef is not a violation', (t) => {
  const { cwd, baseSha } = makeRepo(t);
  const result = evaluateBead(
    { id: 'test-1', close_reason: `Fixed in ${baseSha}: base commit landed on main.` },
    { cwd, mainRef: 'main' },
  );
  assert.equal(result.status, 'passed');
  assert.equal(result.sha, baseSha);
  assert.ok(!result.violation);
});

test('evaluateBead: a SHA that is NOT an ancestor with no annotation is a violation', (t) => {
  const { cwd, featureSha } = makeRepo(t);
  const result = evaluateBead(
    { id: 'test-2', close_reason: `Implemented in ${featureSha} per the plan.` },
    { cwd, mainRef: 'main' },
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.violation, true);
  assert.equal(result.sha, featureSha);
});

test('evaluateBead: a SHA that is NOT an ancestor but carries the unmerged annotation is not a violation', (t) => {
  const { cwd, featureSha } = makeRepo(t);
  const result = evaluateBead(
    {
      id: 'test-3',
      close_reason: `Implemented in ${featureSha} on the feature branch — verified NOT reachable from origin/main; delivered unmerged pending review.`,
    },
    { cwd, mainRef: 'main' },
  );
  assert.equal(result.status, 'passed');
  assert.equal(result.annotated, true);
  assert.ok(!result.violation);
});

test('evaluateBead: a close reason with no SHA at all is not-applicable, not a violation', (t) => {
  const { cwd } = makeRepo(t);
  const result = evaluateBead(
    { id: 'test-4', close_reason: 'Closed as superseded by the new epic structure, no code change.' },
    { cwd, mainRef: 'main' },
  );
  assert.equal(result.status, 'not-applicable');
  assert.equal(result.sha, null);
  assert.ok(!result.violation);
});

test('evaluateBead: a SHA-shaped token that does not resolve locally degrades to unknown, not a crash', (t) => {
  const { cwd } = makeRepo(t);
  const result = evaluateBead(
    { id: 'test-5', close_reason: 'Fixed in abc1234def5678: never fetched locally.' },
    { cwd, mainRef: 'main' },
  );
  assert.equal(result.status, 'unknown');
  assert.equal(result.sha, 'abc1234def5678');
  assert.ok(!result.violation);
});

test('evaluateBead: an unresolvable SHA WITH the unmerged annotation still passes gracefully', (t) => {
  const { cwd } = makeRepo(t);
  const result = evaluateBead(
    { id: 'test-6', close_reason: 'Fixed in abc1234def5678 on a branch not reachable from origin/main, unmerged.' },
    { cwd, mainRef: 'main' },
  );
  assert.equal(result.status, 'passed');
  assert.equal(result.annotated, true);
});

test('check(): rolls up to failed when any evaluated bead violates, and surfaces it in violations', async (t) => {
  const { cwd, baseSha, featureSha } = makeRepo(t);
  const beads = [
    { id: 'ok-1', close_reason: `Fixed in ${baseSha}: landed on main.` },
    { id: 'violation-1', close_reason: `Implemented in ${featureSha} per the plan.` },
    { id: 'na-1', close_reason: 'Closed as duplicate.' },
  ];
  const result = await check({ cwd, mainRef: 'main', listClosedBeads: () => beads });
  assert.equal(result.status, 'failed');
  assert.equal(result.evaluated, 2, 'the no-SHA bead is filtered out before evaluation');
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].beadId, 'violation-1');
});

test('check(): passes when every cited SHA is an ancestor or explicitly annotated', async (t) => {
  const { cwd, baseSha, featureSha } = makeRepo(t);
  const beads = [
    { id: 'ok-1', close_reason: `Fixed in ${baseSha}: landed on main.` },
    { id: 'ok-2', close_reason: `Implemented in ${featureSha} on the feature branch, verified NOT reachable from origin/main, unmerged.` },
  ];
  const result = await check({ cwd, mainRef: 'main', listClosedBeads: () => beads });
  assert.equal(result.status, 'passed');
  assert.equal(result.violations.length, 0);
});

test('check(): an unresolvable SHA with no violations rolls up to unknown, not passed', async (t) => {
  const { cwd, baseSha } = makeRepo(t);
  const beads = [
    { id: 'ok-1', close_reason: `Fixed in ${baseSha}: landed on main.` },
    { id: 'unresolvable-1', close_reason: 'Fixed in abc1234def5678: never fetched locally.' },
  ];
  const result = await check({ cwd, mainRef: 'main', listClosedBeads: () => beads });
  assert.equal(result.status, 'unknown');
  assert.equal(result.violations.length, 0);
  assert.equal(result.unresolved.length, 1);
});

test('evaluateBead: a non-ancestor SHA resolves via a single rewritten-SHA commit naming the bead id on mainRef', (t) => {
  const { cwd, featureSha } = makeRepo(t);
  git(cwd, ['commit', '--allow-empty', '-q', '-m', 'fix(thing): landed after rebase (rewrite-test-1)']);
  const result = evaluateBead(
    { id: 'rewrite-test-1', close_reason: `Implemented in ${featureSha} per the plan.` },
    { cwd, mainRef: 'main' },
  );
  assert.equal(result.status, 'passed');
  assert.ok(!result.violation);
  assert.match(result.supersededBy, /^[0-9a-f]{7,40}$/);
});

test('evaluateBead: a non-ancestor SHA stays a violation when the bead id matches more than one mainRef commit', (t) => {
  const { cwd, featureSha } = makeRepo(t);
  git(cwd, ['commit', '--allow-empty', '-q', '-m', 'fix(thing): first pass (rewrite-test-2)']);
  git(cwd, ['commit', '--allow-empty', '-q', '-m', 'fix(thing): follow-up (rewrite-test-2)']);
  const result = evaluateBead(
    { id: 'rewrite-test-2', close_reason: `Implemented in ${featureSha} per the plan.` },
    { cwd, mainRef: 'main' },
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.violation, true);
  assert.equal(result.supersededBy, undefined);
});

test('check(): a throwing listClosedBeads degrades to collection-error, not a crash', async () => {
  const result = await check({
    listClosedBeads: () => { throw new Error('bd not found on PATH'); },
  });
  assert.equal(result.status, 'collection-error');
  assert.match(result.detail, /bd not found on PATH/);
});
