/**
 * tests/kernel/store/reconcile.test.ts — the field-authority rule, asserted
 * through real persisted state.
 *
 * The rule: a domain-owned field is never overwritten by the tracker, and a
 * tracker-owned field is never overwritten by the domain. The pure reconciler
 * can report a conflict, but only a persisted round trip proves the stored
 * domain value was actually left alone — which is the whole reason this port
 * waited for the substrate.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { getProjection, putProjection } from '../../../src/kernel/store/projections.ts';
import { syncProjections } from '../../../src/kernel/store/reconcile.ts';
import { buildProjection } from '../../../src/kernel/tracker/projection.ts';
import {
  applyReconciliation,
  planDependencyProjection,
  reconcileAll,
  reconcileProjection,
} from '../../../src/kernel/tracker/reconcile.ts';

const AT = '2026-08-03T00:00:00.000Z';
const LATER = '2026-08-04T00:00:00.000Z';

function withStore<T>(fn: (store: ReturnType<typeof openStore>) => T): T {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    return fn(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

// `status` is tracker-owned, `title` and `description` are domain-owned.
const ISSUE = {
  id: 'construct-1',
  title: 'Build the substrate',
  description: 'why this exists',
  status: 'open',
  priority: 2,
};

test('a tracker-owned change is absorbed into the stored snapshot', () => {
  withStore((store) => {
    putProjection(store, buildProjection(ISSUE, { importedAt: AT }));

    const report = syncProjections(store, [{ ...ISSUE, status: 'closed' }], LATER);

    assert.equal(report.counts.absorbed, 1);
    assert.equal(report.counts.drifted, 0);
    assert.ok(report.ok);

    const stored = getProjection(store, 'beads:construct-1');
    assert.equal(stored?.fields.status, 'closed', 'tracker owns status; the snapshot adopts it');
    assert.equal(stored?.state, 'in_sync');
    assert.equal(stored?.reconciledAt, LATER);
  });
});

test('a domain-owned change is reported as drift and never clobbered in storage', () => {
  withStore((store) => {
    putProjection(store, buildProjection(ISSUE, { importedAt: AT }));

    const report = syncProjections(store, [{ ...ISSUE, title: 'Renamed in the tracker' }], LATER);

    assert.equal(report.counts.drifted, 1);
    assert.equal(report.ok, false);
    assert.deepEqual(report.drifted[0].conflicts, [
      { field: 'title', domain: 'Build the substrate', tracker: 'Renamed in the tracker' },
    ]);

    const stored = getProjection(store, 'beads:construct-1');
    assert.equal(
      stored?.fields.title,
      'Build the substrate',
      'domain owns title; the tracker must not overwrite it',
    );
    assert.equal(stored?.state, 'drifted');
  });
});

test('a domain conflict does not block absorbing tracker-owned changes in the same record', () => {
  withStore((store) => {
    putProjection(store, buildProjection(ISSUE, { importedAt: AT }));

    syncProjections(store, [{ ...ISSUE, title: 'Renamed', status: 'closed' }], LATER);

    const stored = getProjection(store, 'beads:construct-1');
    assert.equal(stored?.fields.status, 'closed', 'each field is judged by its own authority');
    assert.equal(stored?.fields.title, 'Build the substrate');
    assert.equal(stored?.state, 'drifted');
  });
});

test('a materialized domain record outranks the snapshot as the domain baseline', () => {
  withStore((store) => {
    putProjection(store, buildProjection(ISSUE, { importedAt: AT }));

    const report = syncProjections(store, [ISSUE], LATER, {
      domainRecords: { 'construct-1': { title: 'The real domain title' } },
    });

    assert.equal(report.counts.drifted, 1);
    assert.deepEqual(report.drifted[0].conflicts, [
      { field: 'title', domain: 'The real domain title', tracker: 'Build the substrate' },
    ]);
  });
});

test('an issue that vanished from the tracker drifts but is never deleted', () => {
  withStore((store) => {
    putProjection(store, buildProjection(ISSUE, { importedAt: AT }));

    const report = syncProjections(store, [], LATER);

    assert.equal(report.counts.missing, 1);
    assert.equal(report.missing[0].reason, 'issue-absent-from-tracker');
    assert.equal(report.ok, false);

    const stored = getProjection(store, 'beads:construct-1');
    assert.ok(stored, 'a tracker deletion must not delete domain work');
    assert.equal(stored.state, 'drifted');
    assert.equal(stored.fields.title, 'Build the substrate');
  });
});

test('an unchanged issue is in_sync and the audit copy is untouched throughout', () => {
  withStore((store) => {
    const projection = buildProjection(ISSUE, { importedAt: AT });
    putProjection(store, projection);

    syncProjections(store, [{ ...ISSUE, status: 'closed' }], LATER);
    const afterAbsorb = getProjection(store, 'beads:construct-1');
    assert.deepEqual(afterAbsorb?.raw_record, ISSUE);

    const report = syncProjections(store, [{ ...ISSUE, status: 'closed' }], LATER);
    assert.equal(report.counts.inSync, 1);
    assert.deepEqual(getProjection(store, 'beads:construct-1')?.raw_record, ISSUE);
  });
});

test('reconciling is clock-free: identical inputs produce identical reports', () => {
  const projection = buildProjection(ISSUE, { importedAt: AT });
  const a = reconcileAll([projection], [{ ...ISSUE, status: 'closed' }], LATER);
  const b = reconcileAll([projection], [{ ...ISSUE, status: 'closed' }], LATER);
  assert.deepEqual(a, b);
});

test('applyReconciliation does not mutate its input and leaves raw_record alone', () => {
  const projection = buildProjection(ISSUE, { importedAt: AT });
  const live = { ...ISSUE, status: 'closed' };
  const result = reconcileProjection(projection, live);
  const next = applyReconciliation(projection, live, result, LATER);

  assert.equal(projection.fields.status, 'open', 'input must not be mutated');
  assert.equal(next.fields.status, 'closed');
  assert.deepEqual(next.raw_record, projection.raw_record);
});

test('the dependency write-back plan is per-edge, never a graph create', () => {
  const projection = buildProjection({
    id: 'construct-2',
    dependencies: [
      { issue_id: 'construct-2', depends_on_id: 'construct-1' },
      { depends_on_id: 'construct-3' },
      { depends_on_id: null },
    ],
  });
  const plan = planDependencyProjection(projection);
  assert.deepEqual(plan.commands, [
    ['dep', 'add', 'construct-2', 'construct-1'],
    ['dep', 'add', 'construct-2', 'construct-3'],
  ]);
  assert.ok(
    plan.commands.every((c) => !c.includes('--graph')),
    'the graph path is lossy and must never be planned',
  );
});
