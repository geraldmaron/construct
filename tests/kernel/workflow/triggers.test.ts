/**
 * tests/kernel/workflow/triggers.test.ts — a standing outcome fires
 * idempotently from an external clock, honors overlap, records every skip,
 * blocks on stale data, and writes the recipe the clock needs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listFirings } from '../../../src/kernel/state/triggers.ts';
import { fixture, T0 } from './support.ts';

test('a schedule trigger is validated, computes its next due instant, and fires once per tick', () => {
  const fx = fixture({ interactive: false });
  try {
    assert.throws(() => fx.triggers.define({ workflowId: 'apply', kind: 'schedule', scheduleExpression: '0 9 * * 1', timezone: 'UTC', adapter: 'cron', overlap: 'skip', maxTier: 'external_write', delivery: {}, input: {} }), /does not accept schedule/);
    assert.throws(() => fx.triggers.define({ workflowId: 'sweep', kind: 'schedule', scheduleExpression: 'nope', timezone: 'UTC', adapter: 'cron', overlap: 'skip', maxTier: 'observe', delivery: {}, input: {} }), /five fields/);
    assert.throws(() => fx.triggers.define({ workflowId: 'review', kind: 'schedule', scheduleExpression: '0 9 * * 1', timezone: 'UTC', adapter: 'cron', overlap: 'skip', maxTier: 'draft', delivery: {}, input: { target: 't' } }), /permission boundary \(draft\) is below/);
    const t = fx.triggers.define({ id: 'monthly', workflowId: 'sweep', kind: 'schedule', scheduleExpression: '0 9 1 * *', timezone: 'Europe/Berlin', adapter: 'cron', overlap: 'skip', maxTier: 'observe', delivery: { destination: 'inbox' }, input: {} });
    assert.equal(t.nextDueAt, '2026-10-01T07:00:00.000Z');
    assert.deepEqual(fx.triggers.due(T0), []);
    assert.deepEqual(fx.triggers.due('2026-10-01T07:00:00.000Z').map((x) => x.id), ['monthly']);

    const first = fx.triggers.fire({ triggerId: 'monthly', firingKey: 'tick-1' });
    assert.equal(first.outcome, 'started');
    assert.ok(first.runId);
    const dup = fx.triggers.fire({ triggerId: 'monthly', firingKey: 'tick-1' });
    assert.equal(dup.outcome, 'deduplicated');
    assert.equal(dup.runId, first.runId);
    const overlap = fx.triggers.fire({ triggerId: 'monthly', firingKey: 'tick-2' });
    assert.equal(overlap.outcome, 'skipped_overlap');
    assert.match(overlap.reason, /still active/);
    assert.deepEqual(listFirings(fx.store, 'monthly').map((f) => f.outcome).sort(), ['skipped_overlap', 'started']);

    // The headless runner does the one step, then the next tick starts fresh.
    const work = fx.service.claimNext({ runId: first.runId!, owner: 'runner:cron' });
    assert.equal(work.packet?.step.id, 'read');
    fx.service.submit({ leased: work.packet!.leased, output: { seen: 3 } });
    assert.equal(fx.service.status(first.runId!)!.run.state, 'succeeded');
    const next = fx.triggers.fire({ triggerId: 'monthly', firingKey: 'tick-3' });
    assert.equal(next.outcome, 'started');
    assert.notEqual(next.runId, first.runId);

    fx.triggers.enable('monthly', false);
    assert.equal(fx.triggers.fire({ triggerId: 'monthly', firingKey: 'tick-4' }).outcome, 'disabled');
    assert.equal(fx.triggers.due('2027-01-01T00:00:00.000Z').length, 0, 'a disabled trigger is never due');
  } finally {
    fx.cleanup();
  }
});

test('stale data blocks a firing whose workflow says so; no data succeeds empty when it says so; dry-run starts nothing', () => {
  const fx = fixture({ interactive: false });
  try {
    fx.triggers.define({ id: 'sweep', workflowId: 'sweep', kind: 'schedule', scheduleExpression: '0 9 * * *', timezone: 'UTC', adapter: 'ci', overlap: 'replace', maxTier: 'observe', delivery: {}, input: {} });
    fx.sources = [{ kind: 'directory', id: 'repo', reachability: 'reachable', freshness: 'stale' }];
    const dry = fx.triggers.fire({ triggerId: 'sweep', firingKey: 'k0', dryRun: true });
    assert.equal(dry.outcome, 'dry_run');
    assert.match(dry.reason, /stale/);
    assert.equal(listFirings(fx.store, 'sweep').length, 0);
    const blocked = fx.triggers.fire({ triggerId: 'sweep', firingKey: 'k1' });
    assert.equal(blocked.outcome, 'blocked');
    assert.match(blocked.reason, /stale/);
    fx.sources = [{ kind: 'directory', id: 'repo', reachability: 'reachable', freshness: 'fresh' }];
    const started = fx.triggers.fire({ triggerId: 'sweep', firingKey: 'k2' });
    assert.equal(started.outcome, 'started');
    const work = fx.service.claimNext({ runId: started.runId!, owner: 'runner:ci' });
    const empty = fx.service.submit({ leased: work.packet!.leased, output: {}, noData: true });
    assert.equal(empty.run.state, 'succeeded', 'onNoData succeed_empty');
    // Replace: a newer firing cancels the active run.
    const a = fx.triggers.fire({ triggerId: 'sweep', firingKey: 'k3' });
    const b = fx.triggers.fire({ triggerId: 'sweep', firingKey: 'k4' });
    assert.equal(b.outcome, 'replaced');
    assert.equal(fx.service.status(a.runId!)!.run.state, 'cancelled');
    assert.equal(fx.service.status(b.runId!)!.run.state, 'ready');
  } finally {
    fx.cleanup();
  }
});

test('recipes name the trigger, the project, and the firing key, for cron and CI', () => {
  const fx = fixture({ interactive: false });
  try {
    fx.triggers.define({ id: 'monthly', workflowId: 'sweep', kind: 'schedule', scheduleExpression: '0 9 1 * *', timezone: 'Europe/Berlin', adapter: 'cron', overlap: 'skip', maxTier: 'observe', delivery: {}, input: {} });
    const cron = fx.triggers.recipe('monthly', 'cron');
    assert.match(cron, /^0 9 1 \* \* cd "\/repo" && construct workflow fire monthly --key/m);
    assert.match(cron, /Construct keeps the run ledger/);
    const ci = fx.triggers.recipe('monthly', 'github-actions');
    assert.match(ci, /cron: "0 9 1 \* \*"/);
    assert.match(ci, /construct workflow fire monthly --key "\$GITHUB_RUN_ID"/);
    assert.equal(fx.triggers.nextDue('monthly', '2026-10-01T07:00:00.000Z'), '2026-11-01T08:00:00.000Z');
  } finally {
    fx.cleanup();
  }
});
