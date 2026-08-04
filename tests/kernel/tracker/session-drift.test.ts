/**
 * tests/kernel/tracker/session-drift.test.ts — construct-fnn.
 *
 * Every case here is a hand-built bead-and-evidence pair, never this repo's real
 * tracker. The module's whole job is to notice when the repo and the tracker
 * disagree, and a test that read the live repo would pass or fail for reasons
 * that have nothing to do with the code — the tracker's true state is the input
 * this module is supposed to have an opinion about, not a fixture.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeConflict,
  projectBead,
  reconcileSession,
  repoAnswers,
  ritualContradictions,
  trackerClaims,
} from '../../../src/kernel/tracker/session-drift.ts';

const AT = '2026-08-04T00:00:00.000Z';

const landed = { landingCommits: ['abc123def456'], inFlight: false };
const nothing = { landingCommits: [], inFlight: false };
const working = { landingCommits: [], inFlight: true };

function bead(id: string, status: string, extra: Record<string, unknown> = {}) {
  return { id, status, title: `bead ${id}`, ...extra };
}

test('a closed bead with a landing commit is in sync', () => {
  const report = reconcileSession([bead('construct-a', 'closed')], { 'construct-a': landed }, AT);
  assert.equal(report.counts.inSync, 1);
  assert.equal(report.counts.drifted, 0);
  assert.equal(report.clean, true);
});

test('a closed bead with no landing commit is the drift the ritual exists to catch', () => {
  const report = reconcileSession([bead('construct-a', 'closed')], { 'construct-a': nothing }, AT);
  assert.equal(report.counts.drifted, 1);
  assert.equal(report.clean, false);
  const conflict = report.drifted[0]!.conflicts.find((c) => c.field === 'landed');
  assert.ok(conflict, 'the disagreement must be reported on the `landed` proposition');
  // The tracker asserted it, the repo denies it, and the repo owns this field —
  // so it is a conflict rather than an absorbed tracker update. That asymmetry
  // is the entire reason this reuses kernel/tracker/reconcile.
  assert.equal(conflict.tracker, true);
  assert.equal(conflict.domain, false);
  assert.equal(report.absorbed.length, 0);
});

test('an open bead that a commit already landed is reported too', () => {
  const report = reconcileSession([bead('construct-a', 'open')], { 'construct-a': landed }, AT);
  assert.equal(report.counts.drifted, 1);
  const conflict = report.drifted[0]!.conflicts.find((c) => c.field === 'landed')!;
  assert.equal(conflict.tracker, false);
  assert.equal(conflict.domain, true);
});

test('an in_progress bead with nothing in flight is an abandoned claim', () => {
  const report = reconcileSession(
    [bead('construct-a', 'in_progress')],
    { 'construct-a': nothing },
    AT,
  );
  assert.equal(report.counts.drifted, 1);
  const conflict = report.drifted[0]!.conflicts.find((c) => c.field === 'in_flight')!;
  assert.equal(conflict.tracker, true);
  assert.equal(conflict.domain, false);
});

test('work in flight on an unclaimed bead is drift in the other direction', () => {
  const report = reconcileSession([bead('construct-a', 'open')], { 'construct-a': working }, AT);
  const conflict = report.drifted[0]!.conflicts.find((c) => c.field === 'in_flight')!;
  assert.equal(conflict.tracker, false);
  assert.equal(conflict.domain, true);
});

test('an in_progress bead with work in flight is exactly what it should be', () => {
  const report = reconcileSession(
    [bead('construct-a', 'in_progress')],
    { 'construct-a': working },
    AT,
  );
  assert.equal(report.clean, true);
});

test('one bead can drift on both propositions at once', () => {
  const report = reconcileSession(
    [bead('construct-a', 'closed')],
    { 'construct-a': working },
    AT,
  );
  assert.equal(report.drifted[0]!.conflicts.length, 2);
});

test('a bead nobody gathered evidence for is skipped, not accused', () => {
  // A partial gather must not read as a repo full of drift. A missing
  // measurement is not a finding.
  const report = reconcileSession(
    [bead('construct-a', 'closed'), bead('construct-b', 'closed')],
    { 'construct-a': landed },
    AT,
  );
  assert.equal(report.counts.total, 1);
  assert.equal(report.clean, true);
});

test('a human-labelled bead cannot also be in progress', () => {
  const found = ritualContradictions(bead('construct-a', 'in_progress', { labels: ['human'] }));
  assert.equal(found.length, 1);
  assert.equal(found[0]!.rule, 'human-labelled-bead-is-in-progress');
  // Open and human-labelled is the correct state, not a contradiction.
  assert.deepEqual(ritualContradictions(bead('construct-b', 'open', { labels: ['human'] })), []);
  assert.deepEqual(ritualContradictions(bead('construct-c', 'in_progress')), []);
});

test('a contradiction makes the report unclean even when nothing drifted', () => {
  // It is not a reconciliation conflict — no repo evidence can settle it — so it
  // must not be smuggled into the drifted count, and must still be surfaced.
  const issue = bead('construct-a', 'in_progress', { labels: ['human'] });
  const report = reconcileSession([issue], { 'construct-a': working }, AT);
  assert.equal(report.counts.drifted, 0);
  assert.equal(report.contradictions.length, 1);
  assert.equal(report.ok, true);
  assert.equal(report.clean, false);
});

test('contradictions are found on beads no evidence was gathered for', () => {
  const report = reconcileSession(
    [bead('construct-a', 'in_progress', { labels: ['human'] })],
    {},
    AT,
  );
  assert.equal(report.counts.total, 0);
  assert.equal(report.contradictions.length, 1);
});

test('the projection keeps the whole bead even though it reconciles two fields', () => {
  const issue = bead('construct-a', 'closed', { description: 'why', notes: 'context' });
  const projection = projectBead(issue);
  assert.deepEqual(projection.raw_record, issue);
  assert.deepEqual(Object.keys(projection.field_authority).sort(), ['in_flight', 'landed']);
  for (const authority of Object.values(projection.field_authority)) {
    assert.equal(authority, 'domain', 'the repo owns both propositions, or nothing conflicts');
  }
  assert.equal(projection.external_id, 'construct-a');
  assert.equal(projection.id, 'beads:construct-a');
  // The kernel does not read the clock.
  assert.equal(projection.importedAt, null);
  assert.equal(projection.reconciledAt, null);
});

test('the projection does not alias the issue it was built from', () => {
  const labels = ['human'];
  const projection = projectBead(bead('construct-a', 'closed', { labels }));
  labels.push('mutated');
  assert.deepEqual((projection.raw_record as { labels: string[] }).labels, ['human']);
});

test('claims and answers are the same two propositions, or nothing compares', () => {
  assert.deepEqual(Object.keys(repoAnswers(landed)).sort(), ['in_flight', 'landed']);
  const claims = trackerClaims(bead('construct-a', 'closed'));
  assert.equal(claims.id, 'construct-a');
  assert.deepEqual(Object.keys(claims).sort(), ['id', 'in_flight', 'landed']);
  assert.deepEqual(repoAnswers(undefined), { landed: false, in_flight: false });
});

test('every status that is neither closed nor in_progress claims nothing', () => {
  for (const status of ['open', 'blocked', 'deferred', undefined]) {
    const claims = trackerClaims({ id: 'construct-a', ...(status ? { status } : {}) });
    assert.equal(claims.landed, false, `status ${status}`);
    assert.equal(claims.in_flight, false, `status ${status}`);
  }
});

test('a conflict is described as the fix it calls for, and direction decides which', () => {
  assert.match(describeConflict('landed', false, true), /no commit on the trunk/);
  assert.match(describeConflict('landed', true, false), /a close nobody ran/);
  assert.match(describeConflict('in_flight', false, true), /abandoned claim/);
  assert.match(describeConflict('in_flight', true, false), /not claimed/);
  assert.match(describeConflict('something_else', 1, 2), /something_else/);
});

test('a bead without an id is rejected rather than projected as undefined', () => {
  assert.throws(() => projectBead({ status: 'open' } as never), /string id/);
});
