/**
 * tests/scripts/tracker/session-drift.test.ts — pure reconcile judgments.
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
  describeDivergence,
  lostRecords,
  projectBead,
  reconcileSession,
  repoAnswers,
  ritualContradictions,
  trackerClaims,
} from '../../../scripts/tracker/session-drift.ts';

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
  assert.match(describeConflict('landed', false, true), /no commit on main/);
  assert.match(describeConflict('landed', true, false), /a close nobody ran/);
  assert.match(describeConflict('in_flight', false, true), /abandoned claim/);
  assert.match(describeConflict('in_flight', true, false), /not claimed/);
  assert.match(describeConflict('something_else', 1, 2), /something_else/);
});

test('a bead without an id is rejected rather than projected as undefined', () => {
  assert.throws(() => projectBead({ status: 'open' } as never), /string id/);
});

/**
 * The ritual says every drift fix is a dated note on the bead. Until the checker
 * read those notes it re-derived the same disagreement on every run, so the
 * beads a session had already accounted for stayed in the working list and the
 * ones that still needed a person had to be found among them.
 */
test('a dated note naming the direction settles that disagreement', () => {
  const note = '2026-08-05 DRIFT ADJUDICATED (closed-without-commit): a decision bead lands no code.';
  const report = reconcileSession(
    [bead('construct-a', 'closed', { notes: note })],
    { 'construct-a': nothing },
    AT,
  );

  assert.equal(report.counts.drifted, 0);
  assert.equal(report.counts.adjudicated, 1);
  assert.equal(report.adjudicated[0]?.external_id, 'construct-a');
  assert.equal(report.clean, true);
});

test('the older bare marker means the direction it was only ever written for', () => {
  const report = reconcileSession(
    [bead('construct-a', 'closed', { notes: '2026-08-05 DRIFT RESOLVED (audit): predates the trailer convention.' })],
    { 'construct-a': nothing },
    AT,
  );

  assert.equal(report.counts.adjudicated, 1);
  assert.equal(report.counts.drifted, 0);
});

/**
 * The reason the direction is recorded rather than a bare "settled": a bead can
 * be adjudicated in one direction and later disagree in the other, and the old
 * verdict was never about the new disagreement.
 */
test('a verdict on one direction does not settle the opposite one', () => {
  const note = '2026-08-05 DRIFT ADJUDICATED (closed-without-commit): a decision bead lands no code.';
  const report = reconcileSession(
    [bead('construct-a', 'open', { notes: note })],
    { 'construct-a': landed },
    AT,
  );

  assert.equal(report.counts.adjudicated, 0);
  assert.equal(report.counts.drifted, 1);
  assert.equal(report.clean, false);
});

test('an unsettled conflict survives on a bead whose other conflict is settled', () => {
  const note = '2026-08-05 DRIFT ADJUDICATED (closed-without-commit): landed under a sibling trailer.';
  const report = reconcileSession(
    [bead('construct-a', 'closed', { notes: note })],
    { 'construct-a': { landingCommits: [], inFlight: true } },
    AT,
  );

  assert.equal(report.counts.drifted, 1);
  assert.equal(report.drifted[0]?.conflicts.length, 1);
  assert.equal(report.drifted[0]?.conflicts[0]?.field, 'in_flight');
});

test('a bead with no notes is unaffected, and adjudication never invents agreement', () => {
  const report = reconcileSession([bead('construct-a', 'closed')], { 'construct-a': nothing }, AT);

  assert.equal(report.counts.adjudicated, 0);
  assert.equal(report.counts.drifted, 1);
  assert.equal(report.clean, false);
});

/**
 * The regression the commit-side reconcile is structurally blind to: a close
 * recorded before an un-pushed database state, overwritten when a later session
 * started from the pushed one. No commit changed, so nothing on the commit side
 * disagrees. The export's own history is the only witness left.
 */

function history(
  everClosed: string[],
  everFiled: string[] = everClosed,
  extra: Record<string, unknown> = {},
) {
  return { everClosed, everFiled, commitsScanned: 12, truncated: false, ...extra };
}

test('a bead history recorded closed and the export now shows open is a lost close', () => {
  const report = lostRecords([bead('construct-a', 'open')], history(['construct-a']));
  assert.deepEqual(report.lostCloses, ['construct-a']);
  assert.deepEqual(report.missingRecords, []);
  assert.equal(report.clean, false);
  assert.equal(report.commitsScanned, 12);
});

test('a bead history filed and the export no longer carries is a lost record', () => {
  const report = lostRecords([bead('construct-a', 'open')], history([], ['construct-a', 'construct-b']));
  assert.deepEqual(report.missingRecords, ['construct-b']);
  assert.equal(report.clean, false);
});

test('a dated reopening note explains the disagreement and keeps it off the list', () => {
  const note = '2026-08-21 REOPENED: the deliverable it promised was never produced.';
  const report = lostRecords([bead('construct-a', 'open', { notes: note })], history(['construct-a']));
  assert.deepEqual(report.lostCloses, []);
  assert.deepEqual(report.reopened, ['construct-a']);
  assert.equal(report.clean, true);
});

test('an undated mention of reopening does not excuse a lost close', () => {
  // A record a stranger cannot date is a record a stranger cannot check.
  const report = lostRecords(
    [bead('construct-a', 'open', { notes: 'we might have REOPENED this at some point' })],
    history(['construct-a']),
  );
  assert.deepEqual(report.lostCloses, ['construct-a']);
});

test('a bead still closed in the export agrees with its own history', () => {
  const report = lostRecords([bead('construct-a', 'closed')], history(['construct-a']));
  assert.equal(report.clean, true);
  assert.deepEqual(report.lostCloses, []);
  assert.deepEqual(report.reopened, []);
});

test('a close made today and never seen in history is work, not a regression', () => {
  // The sweep is one-directional on purpose: reporting every close that history
  // has not caught up with yet would bury the closes that actually went missing.
  const report = lostRecords([bead('construct-a', 'closed')], history([], ['construct-a']));
  assert.equal(report.clean, true);
});

test('a truncated walk says so rather than passing off a partial sweep as a whole one', () => {
  const report = lostRecords([], history([], [], { truncated: true, commitsScanned: 200 }));
  assert.equal(report.truncated, true);
  assert.equal(report.commitsScanned, 200);
  assert.equal(report.clean, true);
});

test('no history gathered is no finding', () => {
  const report = lostRecords([bead('construct-a', 'open')], undefined);
  assert.equal(report.clean, true);
  assert.equal(report.commitsScanned, 0);
  assert.equal(report.truncated, false);
});

/**
 * Branch lag reads exactly like a real loss to this sweep: a checkout sitting
 * behind another ref sees that ref's later closes and filings as absent. The
 * four conflict directions above already have a way to quiet a benign
 * disagreement with a dated note; these two lost-record directions need the
 * same escape hatch, or branch-lag noise can only ever be silenced by
 * refiling something that was never actually lost.
 */

test('a dated note on the bead settles its own lost-close finding', () => {
  const note = '2026-08-21 DRIFT ADJUDICATED (lost-close): this checkout was behind main, not a real loss.';
  const report = lostRecords([bead('construct-a', 'open', { notes: note })], history(['construct-a']));
  assert.deepEqual(report.lostCloses, []);
  assert.deepEqual(report.adjudicated, ['construct-a']);
  assert.equal(report.clean, true);
});

test('a verdict on a different direction does not settle a lost close', () => {
  // Naming the direction is what ties a verdict to the disagreement it was
  // about — the same rule the four conflict directions already follow.
  const note = '2026-08-21 DRIFT ADJUDICATED (closed-without-commit): an unrelated verdict on this bead.';
  const report = lostRecords([bead('construct-a', 'open', { notes: note })], history(['construct-a']));
  assert.deepEqual(report.lostCloses, ['construct-a']);
  assert.deepEqual(report.adjudicated, []);
  assert.equal(report.clean, false);
});

test('a dated note on any current bead settles a missing filing when it names the id', () => {
  // No bead is left to carry construct-b's own notes, so the documented
  // equivalent is a marker on some other bead that spells the id out.
  const note = '2026-08-21 DRIFT ADJUDICATED (missing-filing): construct-b filed only on an abandoned branch, never merged.';
  const report = lostRecords(
    [bead('construct-a', 'open', { notes: note })],
    history([], ['construct-b']),
  );
  assert.deepEqual(report.missingRecords, []);
  assert.deepEqual(report.adjudicated, ['construct-b']);
  assert.equal(report.clean, true);
});

test('a missing-filing note settles only the id it names', () => {
  const note = '2026-08-21 DRIFT ADJUDICATED (missing-filing): construct-c was branch lag.';
  const report = lostRecords(
    [bead('construct-a', 'open', { notes: note })],
    history([], ['construct-b']),
  );
  assert.deepEqual(report.missingRecords, ['construct-b']);
  assert.deepEqual(report.adjudicated, []);
});

test('a missing-filing note about a longer id does not settle a shorter one it merely contains', () => {
  // construct-a1 and construct-a1.2 are different beads, and "construct-a1" is
  // literally a prefix of "construct-a1.2". A plain substring test would let a
  // note naming the child silently also claim the parent's finding.
  const note = '2026-08-21 DRIFT ADJUDICATED (missing-filing): construct-a1.2 was branch lag.';
  const report = lostRecords(
    [bead('construct-z', 'open', { notes: note })],
    history([], ['construct-a1']),
  );
  assert.deepEqual(report.missingRecords, ['construct-a1']);
});

test('a bare marker settles neither lost-record direction', () => {
  // The bare form is the pre-direction convention, and it was only ever
  // written for closed-without-commit — it must not silently reach further.
  const bare = '2026-08-21 DRIFT ADJUDICATED: no direction named.';
  const closeReport = lostRecords([bead('construct-a', 'open', { notes: bare })], history(['construct-a']));
  assert.deepEqual(closeReport.lostCloses, ['construct-a']);

  const missingReport = lostRecords(
    [bead('construct-a', 'open', { notes: `${bare} construct-b` })],
    history([], ['construct-b']),
  );
  assert.deepEqual(missingReport.missingRecords, ['construct-b']);
});

test('a lost close and a missing filing are each adjudicated independently in one sweep', () => {
  const closeNote = '2026-08-21 DRIFT ADJUDICATED (lost-close): branch lag.';
  const missingNote = '2026-08-21 DRIFT ADJUDICATED (missing-filing): construct-c was branch lag.';
  const report = lostRecords(
    [
      bead('construct-a', 'open', { notes: closeNote }),
      bead('construct-b', 'open', { notes: missingNote }),
    ],
    history(['construct-a'], ['construct-a', 'construct-c']),
  );
  assert.deepEqual(report.lostCloses, []);
  assert.deepEqual(report.missingRecords, []);
  assert.deepEqual(report.adjudicated.slice().sort(), ['construct-a', 'construct-c']);
  assert.equal(report.clean, true);
});

/**
 * Four beads were implemented twice because sessions worked main and a
 * direction branch in parallel and the branch session judged the earlier work
 * lost. What it needed was not a smarter search: it was being told, before it
 * started, which beads already had commits it could not see.
 */

function standing(extra: Record<string, unknown> = {}) {
  return {
    head: 'side',
    mainBranch: 'main',
    aheadOfMain: 0,
    behindMain: 0,
    upstream: null,
    aheadOfUpstream: 0,
    behindUpstream: 0,
    beadsOnlyOnMain: [],
    ...extra,
  };
}

test('a checkout behind main names the beads whose commits it cannot see', () => {
  const report = describeDivergence(
    standing({ aheadOfMain: 3, behindMain: 2, beadsOnlyOnMain: ['construct-a', 'construct-b'] }),
  );
  assert.equal(report.diverged, true);
  assert.deepEqual(report.beadsOnlyOnMain, ['construct-a', 'construct-b']);
  const said = report.lines.join('\n');
  assert.match(said, /3 commits ahead of main and 2 commits behind it/);
  assert.match(said, /construct-a, construct-b/);
  assert.match(said, /before re-implementing/);
  // Never a fetch: the report has to be true of what this machine already knows.
  assert.match(said, /nothing was fetched/);
});

test('an up-to-date checkout says nothing at all', () => {
  const report = describeDivergence(standing({ head: 'main' }));
  assert.equal(report.diverged, false);
  assert.deepEqual(report.lines, []);
});

test('being ahead is what a branch is for, not a divergence to report', () => {
  // A branch with commits main lacks, and a local commit not yet pushed, are
  // both the designed state here. Reporting them would fire on every commit.
  const report = describeDivergence(
    standing({ aheadOfMain: 7, upstream: 'origin/side', aheadOfUpstream: 7 }),
  );
  assert.equal(report.diverged, false);
});

test('an upstream carrying commits this checkout lacks is divergence too', () => {
  const report = describeDivergence(
    standing({ upstream: 'origin/side', behindUpstream: 4, aheadOfUpstream: 1 }),
  );
  assert.equal(report.diverged, true);
  assert.match(report.lines.join('\n'), /1 commit ahead of origin\/side and 4 commits behind it/);
});

test('a branch tracking nothing is not described as tracking something', () => {
  const report = describeDivergence(standing({ behindMain: 1 }));
  assert.equal(
    report.lines.some((line) => line.includes('upstream')),
    false,
  );
});

test('commits this checkout lacks that name no bead are still worth saying', () => {
  const report = describeDivergence(standing({ behindMain: 1 }));
  assert.equal(report.diverged, true);
  assert.match(report.lines.join('\n'), /names a bead/);
});

test('a repository with no main to compare against is not a finding', () => {
  const report = describeDivergence(undefined);
  assert.equal(report.diverged, false);
  assert.deepEqual(report.lines, []);
  assert.deepEqual(report.beadsOnlyOnMain, []);
});
