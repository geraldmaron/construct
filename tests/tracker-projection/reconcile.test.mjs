/**
 * tests/tracker-projection/reconcile.test.mjs — detect-and-report
 * reconciliation (construct-b0nny.27 / E8).
 *
 * Asserts the field-authority rule: a tracker-owned field changed in bd is
 * absorbed; a domain-owned field changed in bd is a reported conflict, never
 * clobbered. Covers per-projection reconcile, the folded reconcileAll report,
 * snapshot application, and the safe per-edge write-back plan.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildProjection } from '../../lib/tracker-projection/projection.mjs';
import {
  reconcileProjection,
  applyReconciliation,
  reconcileAll,
  planDependencyProjection,
} from '../../lib/tracker-projection/reconcile.mjs';

function issue(overrides = {}) {
  return {
    id: 'b-1',
    title: 'Original title',
    description: 'body',
    status: 'open',
    priority: 2,
    assignee: 'alice',
    labels: ['x'],
    dependencies: [{ issue_id: 'b-1', depends_on_id: 'b-0', type: 'blocks' }],
    parent: 'b-parent',
    ...overrides,
  };
}

test('a projection reconciled against its own issue is in_sync', () => {
  const projection = buildProjection(issue());
  const result = reconcileProjection(projection, issue());
  assert.equal(result.state, 'in_sync');
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.absorbed, []);
});

test('a tracker-owned change (status/assignee) is absorbed, not a conflict', () => {
  const projection = buildProjection(issue());
  const live = issue({ status: 'in_progress', assignee: 'bob' });
  const result = reconcileProjection(projection, live);
  assert.equal(result.state, 'reconciling');
  assert.deepEqual(result.conflicts, [], 'bd owns status/assignee — no conflict');
  assert.equal(result.absorbed.length, 2);
  assert.ok(result.absorbed.some((a) => a.field === 'status' && a.to === 'in_progress'));
});

test('a domain-owned change (title) is a reported conflict, never clobbered', () => {
  const projection = buildProjection(issue());
  const live = issue({ title: 'Tracker rewrote the title' });
  const result = reconcileProjection(projection, live);
  assert.equal(result.state, 'drifted');
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].field, 'title');
  assert.equal(result.conflicts[0].domain, 'Original title', 'the domain value is retained, not overwritten');
  assert.equal(result.conflicts[0].tracker, 'Tracker rewrote the title');
});

test('a domain-owned change to dependency edges drifts', () => {
  const projection = buildProjection(issue());
  const live = issue({ dependencies: [{ issue_id: 'b-1', depends_on_id: 'b-99', type: 'blocks' }] });
  const result = reconcileProjection(projection, live);
  assert.equal(result.state, 'drifted');
  assert.ok(result.conflicts.some((c) => c.field === 'dependencies'));
});

test('an explicit domainRecord overrides the captured baseline for domain fields', () => {
  const projection = buildProjection(issue());
  const live = issue({ title: 'v2 title' });
  const result = reconcileProjection(projection, live, { domainRecord: { title: 'v2 title' } });
  assert.equal(result.state, 'in_sync', 'live bd matches the current domain record → no drift');
});

test('applyReconciliation adopts tracker updates and leaves raw_record untouched', () => {
  const projection = buildProjection(issue());
  const live = issue({ status: 'closed' });
  const result = reconcileProjection(projection, live);
  const updated = applyReconciliation(projection, live, result);
  assert.equal(updated.fields.status, 'closed', 'absorbed tracker update lands in the snapshot');
  assert.equal(updated.state, 'in_sync');
  assert.deepEqual(updated.raw_record, projection.raw_record, 'raw_record is immutable across reconciliation');
  assert.equal(projection.fields.status, 'open', 'the input projection is not mutated');
});

test('applyReconciliation keeps a drifted projection drifted and does not clobber the domain field', () => {
  const projection = buildProjection(issue());
  const live = issue({ title: 'rewritten' });
  const result = reconcileProjection(projection, live);
  const updated = applyReconciliation(projection, live, result);
  assert.equal(updated.state, 'drifted');
  assert.equal(updated.fields.title, 'Original title', 'domain-owned field is never absorbed from the tracker');
});

test('reconcileAll folds the set and flags an intentionally introduced drift', () => {
  const projections = [buildProjection(issue({ id: 'b-1' })), buildProjection(issue({ id: 'b-2' }))];
  const live = [issue({ id: 'b-1' }), issue({ id: 'b-2', title: 'DRIFTED' })];
  const report = reconcileAll(projections, live);
  assert.equal(report.ok, false);
  assert.equal(report.counts.drifted, 1);
  assert.equal(report.counts.inSync, 1);
  assert.equal(report.drifted[0].external_id, 'b-2');
  assert.equal(report.drifted[0].conflicts[0].field, 'title');
});

test('reconcileAll marks a projection missing when its bead vanished from bd', () => {
  const projections = [buildProjection(issue({ id: 'b-1' }))];
  const report = reconcileAll(projections, []);
  assert.equal(report.ok, false);
  assert.equal(report.counts.missing, 1);
  assert.equal(report.missing[0].reason, 'bead-absent-from-tracker');
});

test('planDependencyProjection emits per-edge bd dep add commands, never bd create --graph', () => {
  const projection = buildProjection(issue({
    dependencies: [
      { issue_id: 'b-1', depends_on_id: 'b-0', type: 'blocks' },
      { issue_id: 'b-1', depends_on_id: 'b-parent', type: 'parent-child' },
    ],
  }));
  const plan = planDependencyProjection(projection);
  assert.equal(plan.commands.length, 2);
  for (const cmd of plan.commands) {
    assert.equal(cmd[0], 'dep');
    assert.equal(cmd[1], 'add');
    assert.notEqual(cmd.join(' ').includes('--graph'), true);
  }
  assert.deepEqual(plan.commands[0], ['dep', 'add', 'b-1', 'b-0']);
});
