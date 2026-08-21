/**
 * tests/kernel/tracker/reconcileDecisions.test.ts — framing drift as
 * decisions, independent of any store.
 *
 * The property under test is the framing, not the comparison:
 * kernel/tracker/reconcile.ts's reconcileAll already decides what counts as
 * drift, so these tests drive it with real fixtures and check what
 * driftDecisions makes of the result — one decision per drifted projection
 * regardless of how many fields disagree, both sides cited, a stable id that
 * a caller can use to avoid raising the same disagreement twice, and a
 * tracker-owned-only change (absorbed, not a conflict) raising nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjection } from '../../../src/kernel/tracker/projection.ts';
import { reconcileAll } from '../../../src/kernel/tracker/reconcile.ts';
import type { DriftReport } from '../../../src/kernel/tracker/reconcile.ts';
import { driftDecisions } from '../../../src/kernel/tracker/reconcileDecisions.ts';

const AT = '2026-08-21T00:00:00.000Z';

// `title` and `description` are domain-owned (kernel/tracker/authority.ts);
// `status` is tracker-owned — the same split a proposal's mirrored issue
// carries (kernel/tracker/crossing.ts's proposalIssue only ever projects
// title and description).
const ISSUE = {
  id: 'p-1',
  title: 'Move PROJ-14 target date to Q4',
  description: 'Why: the vendor slipped their delivery date.',
  status: 'open',
};

test('an unchanged projection raises no decision', () => {
  const projection = buildProjection(ISSUE, { tracker: 'jira', importedAt: AT });
  const report = reconcileAll([projection], [ISSUE], AT);
  assert.deepEqual(driftDecisions(report, [projection]), []);
});

test('a domain-owned conflict becomes one decision citing both sides', () => {
  const projection = buildProjection(ISSUE, { tracker: 'jira', importedAt: AT });
  const live = { ...ISSUE, title: 'Renamed directly in Jira' };
  const report = reconcileAll([projection], [live], AT);

  const decisions = driftDecisions(report, [projection]);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].id, 'reconcile:jira:p-1:title');
  assert.match(decisions[0].question, /title/);
  assert.ok(decisions[0].positions.length >= 2, 'the decision inbox requires at least two positions');

  const roles = decisions[0].positions.map((p) => p.role);
  assert.ok(roles.includes('domain'), 'one position is Construct\'s own recorded value');
  assert.ok(roles.includes('jira'), 'one position is the live tracker read');
  const domainSide = decisions[0].positions.find((p) => p.role === 'domain');
  const trackerSide = decisions[0].positions.find((p) => p.role === 'jira');
  assert.match(domainSide?.stance ?? '', /Move PROJ-14 target date to Q4/);
  assert.match(trackerSide?.stance ?? '', /Renamed directly in Jira/);
});

test('two conflicting fields on one projection is one decision, not two', () => {
  const projection = buildProjection(ISSUE, { tracker: 'jira', importedAt: AT });
  const live = { ...ISSUE, title: 'Renamed', description: 'A different why entirely.' };
  const report = reconcileAll([projection], [live], AT);

  const decisions = driftDecisions(report, [projection]);
  assert.equal(decisions.length, 1, 'one call for the user, not one per field');
  assert.equal(decisions[0].id, 'reconcile:jira:p-1:description+title');
  assert.equal(decisions[0].positions.length, 4, 'two fields, two sides each');
});

test('a tracker-owned-only change is absorbed, not drifted, and raises nothing', () => {
  const projection = buildProjection(ISSUE, { tracker: 'jira', importedAt: AT });
  const live = { ...ISSUE, status: 'closed' };
  const report = reconcileAll([projection], [live], AT);

  assert.equal(report.counts.absorbed, 1);
  assert.equal(report.counts.drifted, 0);
  assert.deepEqual(driftDecisions(report, [projection]), []);
});

test('a projection absent from the live read becomes a "missing" decision', () => {
  const projection = buildProjection(ISSUE, { tracker: 'jira', importedAt: AT });
  const report = reconcileAll([projection], [], AT);

  const decisions = driftDecisions(report, [projection]);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].id, 'reconcile:jira:p-1:missing');
  assert.ok(decisions[0].positions.length >= 2);
  const roles = decisions[0].positions.map((p) => p.role);
  assert.ok(roles.includes('domain'));
  assert.ok(roles.includes('jira'));
});

test('the same disagreement produces the same decision id on a second pass', () => {
  const projection = buildProjection(ISSUE, { tracker: 'jira', importedAt: AT });
  const live = { ...ISSUE, title: 'Renamed' };
  const a = driftDecisions(reconcileAll([projection], [live], AT), [projection]);
  const b = driftDecisions(reconcileAll([projection], [live], AT), [projection]);
  assert.deepEqual(a, b, 'a re-run must be able to recognize the same drift by id alone');
});

test('a different disagreement on the same projection produces a different id', () => {
  const projection = buildProjection(ISSUE, { tracker: 'jira', importedAt: AT });
  const titleDrift = driftDecisions(
    reconcileAll([projection], [{ ...ISSUE, title: 'Renamed' }], AT),
    [projection],
  );
  const descriptionDrift = driftDecisions(
    reconcileAll([projection], [{ ...ISSUE, description: 'Something else.' }], AT),
    [projection],
  );
  assert.notEqual(titleDrift[0]?.id, descriptionDrift[0]?.id);
});

test('a drifted or missing entry with no matching projection is skipped rather than throwing', () => {
  const report: DriftReport = {
    ok: false,
    counts: { total: 0, inSync: 0, absorbed: 0, drifted: 1, missing: 1 },
    inSync: [],
    absorbed: [],
    drifted: [
      {
        external_id: 'ghost-1',
        state: 'drifted',
        absorbed: [],
        conflicts: [{ field: 'title', domain: 'a', tracker: 'b' }],
      },
    ],
    missing: [{ external_id: 'ghost-2', state: 'drifted', reason: 'issue-absent-from-tracker' }],
    reconciledAt: AT,
  };
  assert.deepEqual(driftDecisions(report, []), []);
});
