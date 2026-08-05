/**
 * tests/kernel/plan/plans-store.test.ts — a plan is write-once per run,
 * enforced by the store's triggers rather than caller discipline.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { planFor, recordPlan } from '../../../src/kernel/store/plans.ts';
import { buildPlan } from '../../../src/kernel/plan/planner.ts';

const AT = '2026-08-05T00:00:00.000Z';

function somePlan(run = 'run-1') {
  return buildPlan({
    id: `plan-${run}`,
    run,
    outcome: 'assess the webhook',
    densified: null,
    implicated: [{ domain: 'security', concern: 'c', score: 10, signals: ['webhook'] }],
    inferredBy: 'keywords',
    sources: [],
    mode: 'team',
    plannedAt: AT,
  });
}

test('a recorded plan round-trips and an absent one is null', () => {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    assert.equal(planFor(store, 'run-1'), null);
    const plan = somePlan();
    recordPlan(store, plan);
    assert.deepEqual(planFor(store, 'run-1'), plan);
  } finally {
    store.close();
    fixture.cleanup();
  }
});

test('a second plan for the same run is refused: replanning is a new run', () => {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    recordPlan(store, somePlan());
    assert.throws(() => recordPlan(store, somePlan()));
    assert.throws(
      () => store.db.prepare("UPDATE plans SET plan = '{}' WHERE run = 'run-1'").run(),
      /write-once/,
    );
    assert.throws(() => store.db.prepare('DELETE FROM plans').run(), /write-once/);
  } finally {
    store.close();
    fixture.cleanup();
  }
});
