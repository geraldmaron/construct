/**
 * tests/kernel/workflow/triggers.test.ts — a standing outcome fires
 * idempotently from an external clock, honors overlap, records every skip,
 * blocks on stale data, and writes the recipe the clock needs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listFirings } from '../../../src/kernel/state/triggers.ts';
import { askedOf } from '../../../src/kernel/workflow/asked.ts';
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

test('a weekly trigger covers a fresh week on every firing, worked out at the due time in its own timezone', () => {
  const fx = fixture({ interactive: false });
  try {
    const lastWeek = { semantics: 'changed_during', relative: 'last_week' };
    // Define it on Sunday 2026-10-11, so the first due firing is Monday 09:00 in Berlin.
    moveTo(fx, '2026-10-11T12:00:00.000Z');
    const t = fx.triggers.define({ id: 'weekly', workflowId: 'digest', kind: 'schedule', scheduleExpression: '0 9 * * 1', timezone: 'Europe/Berlin', adapter: 'cron', overlap: 'queue', maxTier: 'draft', delivery: {}, input: { target: 'payments', period: lastWeek, sources: ['jira'] } });
    assert.equal(t.nextDueAt, '2026-10-12T07:00:00.000Z');
    assert.deepEqual(t.input, { target: 'payments', period: lastWeek, sources: ['jira'] }, 'the relative period is stored as given');

    moveTo(fx, '2026-10-12T07:00:00.000Z');
    const first = fx.triggers.fire({ triggerId: 'weekly', firingKey: 'w42' });
    assert.equal(first.outcome, 'started', first.reason);
    const run1 = fx.service.status(first.runId!)!.run;
    assert.deepEqual([askedOf(run1).period?.from, askedOf(run1).period?.to, askedOf(run1).period?.timezone], ['2026-10-05', '2026-10-11', 'Europe/Berlin']);
    assert.deepEqual(askedOf(run1).firing, { triggerId: 'weekly', dueAt: '2026-10-12T07:00:00.000Z' });
    assert.deepEqual(run1.input, { target: 'payments', period: lastWeek, sources: ['jira'] });
    assert.equal(first.nextDueAt, '2026-10-19T07:00:00.000Z');

    moveTo(fx, '2026-10-19T07:00:00.000Z');
    const dry = fx.triggers.fire({ triggerId: 'weekly', firingKey: 'w43', dryRun: true });
    assert.equal(dry.outcome, 'dry_run');
    const second = fx.triggers.fire({ triggerId: 'weekly', firingKey: 'w43' });
    assert.equal(second.outcome, 'started', second.reason);
    assert.notEqual(second.runId, first.runId, 'another week is another run');
    const run2 = fx.service.status(second.runId!)!.run;
    assert.deepEqual([askedOf(run2).period?.from, askedOf(run2).period?.to], ['2026-10-12', '2026-10-18']);
    assert.equal(fx.service.status(first.runId!)!.run.state, 'ready', 'the earlier week’s run is untouched');

    // The clock arrives a day and a bit late, after the clocks went back: the firing still covers the week that was due.
    moveTo(fx, '2026-10-27T10:30:00.000Z');
    const late = fx.triggers.fire({ triggerId: 'weekly', firingKey: 'w44' });
    const run3 = fx.service.status(late.runId!)!.run;
    assert.deepEqual(askedOf(run3).firing, { triggerId: 'weekly', dueAt: '2026-10-26T08:00:00.000Z' });
    assert.deepEqual([askedOf(run3).period?.from, askedOf(run3).period?.to], ['2026-10-19', '2026-10-25']);

    // A tick that arrives more than a week late still covers the week that was due, not the week it arrived in.
    moveTo(fx, '2026-11-10T10:30:00.000Z');
    const later = fx.triggers.fire({ triggerId: 'weekly', firingKey: 'w45' });
    const run4 = fx.service.status(later.runId!)!.run;
    assert.deepEqual(askedOf(run4).firing, { triggerId: 'weekly', dueAt: '2026-11-02T08:00:00.000Z' });
    assert.deepEqual([askedOf(run4).period?.from, askedOf(run4).period?.to], ['2026-10-26', '2026-11-01']);
  } finally {
    fx.cleanup();
  }
});

test('defining a trigger checks its input: undeclared keys, malformed periods, unknown sources, and fixed windows on a standing trigger are refused', () => {
  const fx = fixture({ interactive: false });
  try {
    const define = (input: Record<string, unknown>, kind: 'schedule' | 'manual' = 'schedule') => fx.triggers.define({ workflowId: 'digest', kind, scheduleExpression: kind === 'schedule' ? '0 9 * * 1' : undefined, timezone: kind === 'schedule' ? 'Europe/Berlin' : undefined, adapter: 'cron', overlap: 'skip', maxTier: 'draft', delivery: {}, input });
    assert.throws(() => define({ period: { semantics: 'changed_during', relative: 'last_week' }, owner: 'sam' }), /input "owner" is not declared by the workflow/);
    assert.throws(() => define({ period: { semantics: 'during', relative: 'last_week' } }), /needs "semantics", one of as_of, changed_during, evidence_window/);
    assert.throws(() => define({ period: { semantics: 'changed_during', relative: 'last_week' }, sources: ['datadog'] }), /datadog, which is not a declared active source/);
    assert.throws(() => define({}), /input "period" is required and absent/);
    assert.throws(() => define({ period: { semantics: 'evidence_window', from: '2026-07-01', to: '2026-09-30' } }), /a standing trigger fires again and again; give the period as relative \(for example last_week\)/);
    assert.throws(() => define({ period: { semantics: 'changed_during', quarter: 3, year: 2026 } }), /fixed window/);
    assert.throws(() => define({ period: { semantics: 'changed_during', relative: 'last_quarter', from: '2026-04-01', to: '2026-06-30' } }), /give the relative period alone/);
    const asOf = define({ period: { semantics: 'as_of', to: '2026-09-30' } });
    assert.equal(asOf.workflowId, 'digest', 'a fixed reference date stays allowed');
    const quarter = define({ period: { semantics: 'changed_during', quarter: 3 } });
    assert.ok(quarter.id, 'a quarter without a year moves with the calendar');
  } finally {
    fx.cleanup();
  }
});

function moveTo(fx: ReturnType<typeof fixture>, iso: string): void {
  fx.tick(Date.parse(iso) - Date.parse(fx.now()));
}
