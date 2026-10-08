/**
 * tests/kernel/workflow/typed-inputs.test.ts — a period given as the person
 * framed it is worked out into dates once, when the run is created, and kept
 * on the run: the run's input keeps what was given, every step receives the
 * dates, a different window is different work, and nothing after creation
 * moves it. Named sources travel the same way.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import type { BrokerContext } from '../../../src/kernel/broker/context.ts';
import { askedOf } from '../../../src/kernel/workflow/asked.ts';
import { fixture, T0, type Fixture } from './support.ts';

const DAY = 86_400_000;
const lastQuarter = { semantics: 'changed_during', relative: 'last_quarter', phrase: 'last quarter' };

function bindingsJson(fx: Fixture, runId: string): string {
  return (fx.store.db.prepare('SELECT bindings_json FROM workflow_runs WHERE id = ?').get(runId) as { bindings_json: string }).bindings_json;
}

async function runStatus(fx: Fixture, runId: string): Promise<Record<string, any>> {
  const tool = TOOLS.find((t) => t.name === 'run_status')!;
  return (await tool.run({ workflow: fx.service } as unknown as BrokerContext, tool.validate({ runId }))) as Record<string, any>;
}

test('the run keeps the period as given, freezes it in dates, and run_status shows what it covers', async () => {
  const fx = fixture();
  try {
    const started = fx.service.start({ workflowId: 'digest', input: { target: 'payments', period: lastQuarter, sources: [' jira', 'jira'] }, trigger: 'manual' });
    assert.equal(started.created, true);
    assert.equal(started.run.state, 'ready', started.preflight.summary);
    assert.deepEqual(started.run.input, { target: 'payments', period: lastQuarter, sources: ['jira'] }, 'the period exactly as given; source ids trimmed, without repeats');
    const asked = askedOf(started.run);
    assert.deepEqual([asked.period?.from, asked.period?.to, asked.period?.timezone, asked.period?.how, asked.period?.resolvedAt], ['2026-04-01', '2026-06-30', 'UTC', 'relative', T0]);
    assert.deepEqual(asked.periodSpec, lastQuarter);
    assert.deepEqual(asked.sources, { registered: ['jira'], named: [] });
    assert.equal(asked.firing, undefined);
    assert.deepEqual(started.preflight.period, asked.period);
    assert.ok(started.preflight.assumptions.includes('dates are in UTC'));
    assert.ok(started.preflight.assumptions.includes('quarters are calendar quarters'));

    const status = await runStatus(fx, started.run.id);
    assert.equal(status.run.asked.period.from, '2026-04-01');
    assert.equal(status.run.asked.period.to, '2026-06-30');
    assert.deepEqual(status.run.asked.sources, { registered: ['jira'], named: [] });
    assert.equal(status.run.asked.judgedBy, null);

    const plain = fx.service.start({ workflowId: 'ship', input: { request: 'tidy the README' }, trigger: 'manual' });
    assert.equal(plain.run.bindings && (plain.run.bindings as { asked?: unknown }).asked, null, 'a run with nothing to freeze keeps no reading');
    assert.deepEqual((await runStatus(fx, plain.run.id)).run.asked, { period: null, sources: null, judgedBy: null });
    assert.equal(plain.preflight.period, null);
    assert.deepEqual(plain.preflight.assumptions, []);
  } finally {
    fx.cleanup();
  }
});

test('the same window asked for on another day is the same work; a different window is different work', () => {
  const fx = fixture();
  try {
    const first = fx.service.start({ workflowId: 'digest', input: { target: 'payments', period: lastQuarter }, trigger: 'manual' });
    fx.tick(5 * DAY);
    const again = fx.service.start({ workflowId: 'digest', input: { target: 'payments', period: { semantics: 'changed_during', relative: 'last_quarter' } }, trigger: 'manual' });
    assert.equal(again.created, false);
    assert.equal(again.run.id, first.run.id, 'last_quarter on two days of one quarter is one run');
    assert.deepEqual(again.differs, [], 'a period compares by its dates, not by how it was said');
    assert.equal(again.preflight.period?.resolvedAt, T0, 'the run’s own period, worked out when it was created');

    const named = fx.service.start({ workflowId: 'digest', input: { target: 'payments', period: { semantics: 'changed_during', quarter: 2, year: 2026 } }, trigger: 'manual' });
    assert.equal(named.run.id, first.run.id, 'the same window named as a quarter');
    assert.deepEqual(named.differs, []);

    const month = fx.service.start({ workflowId: 'digest', input: { target: 'payments', period: { semantics: 'changed_during', relative: 'last_month' } }, trigger: 'manual' });
    assert.equal(month.created, true, 'a different window is different work');
    assert.notEqual(month.run.id, first.run.id);
    assert.equal(askedOf(month.run).period?.from, '2026-08-01');
    const meaning = fx.service.start({ workflowId: 'digest', input: { target: 'payments', period: { semantics: 'evidence_window', relative: 'last_quarter' } }, trigger: 'manual' });
    assert.equal(meaning.created, true, 'the same dates read another way are different work');

    // Once the quarter turns, last_quarter is another window.
    fx.tick(40 * DAY);
    const next = fx.service.start({ workflowId: 'digest', input: { target: 'payments', period: lastQuarter }, trigger: 'manual' });
    assert.equal(next.created, true);
    assert.equal(askedOf(next.run).period?.from, '2026-07-01');
  } finally {
    fx.cleanup();
  }
});

test('steps receive the period in dates, and every packet says what the run covers and which sources it names', () => {
  const fx = fixture();
  try {
    const started = fx.service.start({ workflowId: 'digest', input: { target: 'payments', period: lastQuarter, sources: ['jira'] }, trigger: 'manual' });
    const frozen = askedOf(started.run).period;
    const gather = fx.service.claimNext({ runId: started.run.id })!.packet!;
    assert.deepEqual(gather.inputs.period, frozen, 'the step gets the dates, not the words');
    assert.deepEqual(gather.inputs.sources, ['jira']);
    assert.equal(gather.inputs.target, 'payments');
    assert.ok(gather.instructions.includes("This run covers 2026-04-01 to 2026-06-30 (UTC; what changed during it) in this run's reading."), gather.instructions.join('\n'));
    assert.ok(gather.instructions.some((l) => l.startsWith('Read the sources this run names: jira; cite items as <source>:<item>')));
    assert.ok(!gather.instructions.some((l) => /refused/.test(l)));
    fx.tick(10 * DAY);
    fx.service.submit({ leased: gather.leased, output: { notes: 'n' }, evidence: [{ ref: 'jira:PAY-1' }] });
    const write = fx.service.claimNext({ runId: started.run.id })!.packet!;
    assert.deepEqual(write.inputs.period, frozen, 'a later step gets the same dates, however late it runs');
    assert.ok(write.instructions.some((l) => l.startsWith('This run covers 2026-04-01 to 2026-06-30')), 'every step sees the window');

    const asOf = fx.service.start({ workflowId: 'digest', input: { target: 'ledger', period: { semantics: 'as_of', to: '2026-06-30' } }, trigger: 'manual' });
    const packet = fx.service.claimNext({ runId: asOf.run.id })!.packet!;
    assert.ok(packet.instructions.includes("This run covers things as of 2026-06-30 (UTC) in this run's reading. Describe them as they stood at the end of that day."), packet.instructions.join('\n'));
    assert.ok(!packet.instructions.some((l) => l.startsWith('Read the sources')), 'no sources named, no sources line');
  } finally {
    fx.cleanup();
  }
});

test('the frozen reading never changes after creation: not on block, resume, decide, or another start', () => {
  const fx = fixture();
  try {
    fx.sources = [{ kind: 'directory', id: 'repo', reachability: 'reachable', freshness: 'fresh' }];
    const started = fx.service.start({ workflowId: 'digest', input: { target: 'payments', period: lastQuarter, sources: ['jira'] }, trigger: 'manual' });
    assert.equal(started.run.state, 'blocked');
    assert.ok(started.preflight.reasons.some((r) => r.code === 'unavailable_source' && /jira/.test(r.message)));
    const frozen = bindingsJson(fx, started.run.id);
    assert.equal(JSON.parse(frozen).asked.period.to, '2026-06-30');

    fx.tick(45 * DAY);
    fx.sources = [{ kind: 'jira', id: 'jira', reachability: 'reachable', freshness: 'no_expectation' }, { kind: 'directory', id: 'repo', reachability: 'reachable', freshness: 'fresh' }];
    const resumed = fx.service.resume(started.run.id);
    assert.equal(resumed.state, 'ready', 'the source is declared now');
    assert.equal(bindingsJson(fx, started.run.id), frozen);
    assert.equal(askedOf(resumed).period?.to, '2026-06-30', 'resumed in the next quarter, it still covers the quarter it was asked for');

    const gather = fx.service.claimNext({ runId: started.run.id })!.packet!;
    fx.service.submit({ leased: gather.leased, output: { notes: 'n' }, evidence: [] });
    const retry = fx.service.claimNext({ runId: started.run.id })!.packet!;
    const spent = fx.service.submit({ leased: retry.leased, output: { notes: 'n' }, evidence: [] });
    assert.equal(spent.run.state, 'waiting_for_decision');
    const waiver = fx.service.status(started.run.id)!.openDecisions[0]!;
    fx.service.decide({ decisionId: waiver.id, resolution: 'another attempt', by: 'gerald', channel: 'tty_cli' });
    assert.equal(bindingsJson(fx, started.run.id), frozen);
    const third = fx.service.claimNext({ runId: started.run.id })!.packet!;
    assert.equal(third.inputs.period && (third.inputs.period as { to: string }).to, '2026-06-30');
    fx.service.submit({ leased: third.leased, output: { notes: 'n' }, evidence: [{ ref: 'jira:PAY-1' }] });
    const reused = fx.service.start({ workflowId: 'digest', input: { target: 'payments', period: { semantics: 'changed_during', quarter: 2, year: 2026 }, sources: ['jira'] }, trigger: 'manual' });
    assert.equal(reused.run.id, started.run.id);
    assert.equal(bindingsJson(fx, started.run.id), frozen, 'a start that finds the run leaves its reading alone');
  } finally {
    fx.cleanup();
  }
});

test('a start whose period was refused is replaced by the corrected one', () => {
  const fx = fixture();
  try {
    const wrong = fx.service.start({ workflowId: 'digest', input: { target: 'payments', period: { semantics: 'changed_during', relative: 'last_quarter', from: '2026-07-01', to: '2026-09-30' } }, trigger: 'manual' });
    assert.equal(wrong.run.state, 'blocked');
    assert.match(wrong.preflight.reasons[0]!.message, /runs from 2026-04-01 to 2026-06-30/);
    assert.match(wrong.preflight.reasons[0]!.remedy, /^Pass period as \{"semantics"/);
    assert.equal(askedOf(wrong.run).period, undefined, 'a refused period is never frozen as dates');
    const corrected = fx.service.start({ workflowId: 'digest', input: { target: 'payments', period: { semantics: 'changed_during', quarter: 3, year: 2026 } }, trigger: 'manual' });
    assert.equal(corrected.created, true);
    assert.equal(corrected.run.state, 'ready');
    assert.equal(corrected.superseded, wrong.run.id);
    assert.equal(fx.service.status(wrong.run.id)!.run.state, 'cancelled');

    const missing = fx.service.start({ workflowId: 'digest', input: { target: 'ledger' }, trigger: 'manual' });
    const reason = missing.preflight.reasons.find((r) => r.code === 'missing_step_input')!;
    assert.equal(reason.slot, 'period', 'a missing input names its slot');
    assert.match(reason.remedy, /^Provide period as \{"semantics"/);
    const other = fx.service.start({ workflowId: 'digest', input: { target: 'payments', period: { semantics: 'changed_during', relative: 'last_month' } }, trigger: 'manual' });
    assert.equal(other.created, true);
    assert.equal(other.superseded, null, 'a blocked run of other work is left alone');
    assert.equal(fx.service.status(missing.run.id)!.run.state, 'blocked');
  } finally {
    fx.cleanup();
  }
});

test('preflight works the period out without starting anything, at the instant it is asked for', () => {
  const fx = fixture();
  try {
    const now = fx.service.preflight('digest', { period: { semantics: 'changed_during', relative: 'last_week' } });
    assert.equal(now.preflight.status, 'runnable', now.preflight.summary);
    assert.deepEqual([now.preflight.period?.from, now.preflight.period?.to], ['2026-08-24', '2026-08-30']);
    const then = fx.service.preflight('digest', { period: { semantics: 'changed_during', relative: 'last_week' } }, { periodAt: '2026-10-12T07:00:00.000Z', timezone: 'Europe/Berlin' });
    assert.deepEqual([then.preflight.period?.from, then.preflight.period?.to, then.preflight.period?.timezone], ['2026-10-05', '2026-10-11', 'Europe/Berlin']);
    assert.equal(fx.service.status('run-001'), null);
  } finally {
    fx.cleanup();
  }
});

test('a named source last read before the period ended is flagged, and nothing is flagged for a period still running', () => {
  const fx = fixture();
  try {
    fx.sources = [
      { kind: 'jira', id: 'jira', reachability: 'reachable', freshness: 'no_expectation', lastReadAt: '2026-06-15T09:00:00.000Z' },
      { kind: 'directory', id: 'repo', reachability: 'reachable', freshness: 'fresh', lastReadAt: '2026-07-02T09:00:00.000Z' },
      { kind: 'confluence', id: 'wiki', reachability: 'reachable', freshness: 'never_read', lastReadAt: null },
    ];
    const started = fx.service.start({ workflowId: 'digest', input: { target: 'payments', period: lastQuarter, sources: ['jira', 'repo', 'wiki'] }, trigger: 'manual' });
    const flags = started.preflight.flags;
    assert.ok(flags.includes('jira was last read 2026-06-15, before the period ends (2026-06-30); read it again so the whole period is covered'), flags.join('\n'));
    assert.ok(!flags.some((f) => f.startsWith('repo ')), 'read after the period ended');
    assert.ok(flags.some((f) => f.startsWith('wiki has not been read here')));
    assert.equal(started.run.state, 'ready', 'a flag, never a block');
    const running = fx.service.start({ workflowId: 'digest', input: { target: 'payments', period: { semantics: 'changed_during', relative: 'this_quarter' }, sources: ['jira'] }, trigger: 'manual' });
    assert.ok(!running.preflight.flags.some((f) => /jira/.test(f)), 'the period has not ended yet');
  } finally {
    fx.cleanup();
  }
});
