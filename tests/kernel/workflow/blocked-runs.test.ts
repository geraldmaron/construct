/**
 * tests/kernel/workflow/blocked-runs.test.ts — a blocked run is never handed
 * back as if it were under way. A corrected start replaces it, the same start
 * after the world changes resolves it where it stands, a claim on it says
 * why it is stuck, and a run that is reused names the inputs that differ.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { differsFlag } from '../../../src/kernel/workflow/service.ts';
import { listActivity } from '../../../src/kernel/state/activity.ts';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record } from '../../../src/kernel/broker/definition.ts';
import { fixture } from './support.ts';
import { brokerFixture } from '../broker/support.ts';

async function call(fx: ReturnType<typeof brokerFixture>, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const t = TOOLS.find((x) => x.name === name)!;
  return t.run(fx.broker, t.validate(record(args)));
}

test('a start with an undeclared input is blocked; the corrected start cancels it, names the new run, and a claim hands out work', () => {
  const fx = fixture();
  try {
    const wrong = fx.service.start({ workflowId: 'ship', input: { request: 'Rename the invoice helper', dateRange: 'Q3' }, trigger: 'manual' });
    assert.equal(wrong.created, true);
    assert.equal(wrong.run.state, 'blocked');
    assert.ok(wrong.preflight.reasons.some((r) => r.code === 'schema_mismatch' && r.message.includes('dateRange')));
    assert.equal(wrong.superseded, null);

    const told = fx.service.claimNext({ runId: wrong.run.id });
    assert.equal(told.packet, null);
    const waiting = told.waitingOn;
    assert.ok(waiting?.kind === 'blocked', 'a claim on a blocked run is not nothing_ready');
    assert.equal(waiting.runId, wrong.run.id);
    assert.equal(waiting.summary, wrong.run.stateReason);
    assert.ok(waiting.reasons.some((r) => r.code === 'schema_mismatch' && /Remove dateRange/.test(r.remedy)), 'the reason comes with what would clear it');

    const same = fx.service.start({ workflowId: 'ship', input: { request: 'Rename the invoice helper', dateRange: 'Q3' }, trigger: 'manual' });
    assert.equal(same.created, false, 'the same wrong start finds the same blocked run');
    assert.equal(same.run.id, wrong.run.id);
    assert.equal(same.run.state, 'blocked');
    assert.equal(same.preflight.status, 'blocked', 'and its preflight says it is still blocked, not runnable');

    const fixed = fx.service.start({ workflowId: 'ship', input: { request: 'Rename the invoice helper' }, trigger: 'manual' });
    assert.equal(fixed.created, true);
    assert.notEqual(fixed.run.id, wrong.run.id);
    assert.equal(fixed.run.state, 'ready');
    assert.equal(fixed.preflight.status, 'runnable');
    assert.equal(fixed.superseded, wrong.run.id);
    const old = fx.service.status(wrong.run.id)!.run;
    assert.equal(old.state, 'cancelled');
    assert.equal(old.stateReason, `superseded by run ${fixed.run.id}`);
    assert.ok(listActivity(fx.store, { runId: wrong.run.id }).some((e) => e.kind === 'run.transition' && (e.payload as { to?: string }).to === 'cancelled'));

    const claimed = fx.service.claimNext({ runId: fixed.run.id });
    assert.ok(claimed.packet, 'the corrected run hands out its first step');
    assert.equal(claimed.packet.step.id, 'do');

    const again = fx.service.start({ workflowId: 'ship', input: { request: 'Rename the invoice helper' }, trigger: 'manual' });
    assert.equal(again.created, false);
    assert.equal(again.run.id, fixed.run.id);
    assert.deepEqual(again.differs, []);
    assert.equal(again.superseded, null);
  } finally {
    fx.cleanup();
  }
});

test('the same start after the world changes resolves the blocked run where it stands', () => {
  const fx = fixture();
  try {
    fx.sources = [];
    const first = fx.service.start({ workflowId: 'apply', input: { target: 'PROJ-1' }, trigger: 'manual' });
    assert.equal(first.run.state, 'blocked');
    assert.ok(first.preflight.reasons.some((r) => r.code === 'unavailable_source'));

    fx.sources = [{ kind: 'jira', id: 'jira', reachability: 'reachable', freshness: 'no_expectation' }];
    const retried = fx.service.start({ workflowId: 'apply', input: { target: 'PROJ-1' }, trigger: 'manual' });
    assert.equal(retried.created, false);
    assert.equal(retried.run.id, first.run.id, 'no second run for the same work');
    assert.equal(retried.run.state, 'ready');
    assert.equal(retried.preflight.status, 'runnable');
    assert.deepEqual(retried.differs, []);
    assert.equal(retried.superseded, null);
    assert.deepEqual(fx.service.status(first.run.id)!.steps.map((s) => s.stepId), ['draft', 'push']);
    const claimed = fx.service.claimNext({ runId: first.run.id });
    assert.equal(claimed.packet?.step.id, 'draft');
  } finally {
    fx.cleanup();
  }
});

test('starting the same work again is held to the same stale-data rule as a fresh start', () => {
  const fx = fixture();
  try {
    fx.sources = [{ kind: 'jira', id: 'jira', reachability: 'reachable', freshness: 'stale' }];
    const first = fx.service.start({ workflowId: 'tally', input: {}, trigger: 'manual' });
    assert.equal(first.run.state, 'blocked');
    assert.match(first.preflight.summary, /onStaleData: block/);
    const still = fx.service.start({ workflowId: 'tally', input: {}, trigger: 'manual' });
    assert.equal(still.run.id, first.run.id);
    assert.equal(still.run.state, 'blocked', 'a stale source still blocks it');
    assert.ok(still.preflight.reasons.some((r) => r.code === 'stale_source'));
    assert.equal(fx.service.resume(first.run.id).state, 'blocked', 'resume reads the same rule');

    fx.sources = [{ kind: 'jira', id: 'jira', reachability: 'reachable', freshness: 'fresh' }];
    assert.equal(fx.service.resume(first.run.id).state, 'ready');

    fx.sources = [{ kind: 'jira', id: 'jira', reachability: 'reachable', freshness: 'stale' }];
    const live = fx.service.start({ workflowId: 'tally', input: {}, trigger: 'manual' });
    assert.equal(live.created, false);
    assert.equal(live.run.state, 'ready');
    assert.equal(live.preflight.status, 'runnable', 'a run already under way is not reported blocked by a rule that only gates starting');
  } finally {
    fx.cleanup();
  }
});

test('a start that fills in what a blocked run left out replaces it; a blocked run of other work is left alone', () => {
  const fx = fixture();
  try {
    const partial = fx.service.start({ workflowId: 'brief', input: { scope: 'security' }, trigger: 'manual' });
    assert.equal(partial.run.state, 'blocked');
    assert.ok(partial.preflight.reasons.some((r) => r.code === 'missing_step_input' && r.message.includes('target')));
    const filled = fx.service.start({ workflowId: 'brief', input: { target: 'docs/a.md', scope: 'security' }, trigger: 'manual' });
    assert.equal(filled.created, true);
    assert.equal(filled.run.state, 'ready');
    assert.equal(filled.superseded, partial.run.id, 'the start that supplies the missing target is the same work corrected');
    const retired = fx.service.status(partial.run.id)!.run;
    assert.equal(retired.state, 'cancelled');
    assert.equal(retired.stateReason, `superseded by run ${filled.run.id}`);

    const elsewhere = fx.service.start({ workflowId: 'brief', input: { target: 'docs/b.md', bogus: true }, trigger: 'manual' });
    assert.equal(elsewhere.run.state, 'blocked');
    const other = fx.service.start({ workflowId: 'brief', input: { target: 'docs/c.md' }, trigger: 'manual' });
    assert.equal(other.run.state, 'ready');
    assert.equal(other.superseded, null);
    assert.equal(fx.service.status(elsewhere.run.id)!.run.state, 'blocked', 'a different target is other work');
    const vaguer = fx.service.start({ workflowId: 'brief', input: { scope: 'cost' }, trigger: 'manual' });
    assert.equal(vaguer.run.state, 'blocked');
    assert.equal(vaguer.superseded, null);
    assert.equal(fx.service.status(elsewhere.run.id)!.run.state, 'blocked', 'a start that leaves out the target a blocked run gave does not replace it');
  } finally {
    fx.cleanup();
  }
});

test('a blocked per_input run of other work is left alone when a different run resolves', () => {
  const fx = fixture();
  try {
    fx.sources = [];
    const one = fx.service.start({ workflowId: 'apply', input: { target: 'PROJ-1' }, trigger: 'manual' });
    assert.equal(one.run.state, 'blocked');
    fx.sources = [{ kind: 'jira', id: 'jira', reachability: 'reachable', freshness: 'no_expectation' }];
    const two = fx.service.start({ workflowId: 'apply', input: { target: 'PROJ-2' }, trigger: 'manual' });
    assert.equal(two.created, true);
    assert.equal(two.run.state, 'ready');
    assert.equal(two.superseded, null);
    assert.equal(fx.service.status(one.run.id)!.run.state, 'blocked', 'PROJ-1 is other work; it waits for its own fix');
  } finally {
    fx.cleanup();
  }
});

test('under single concurrency a run that resolves retires the workflow’s other blocked runs', () => {
  const fx = fixture();
  try {
    const stuck = fx.service.start({ workflowId: 'review', input: { target: 'feature-x', bogus: true }, trigger: 'manual' });
    assert.equal(stuck.run.state, 'blocked');
    const live = fx.service.start({ workflowId: 'review', input: { target: 'feature-y' }, trigger: 'manual' });
    assert.equal(live.run.state, 'ready');
    assert.equal(live.superseded, null, 'it was other work, not this start’s own blocked run');
    const retired = fx.service.status(stuck.run.id)!.run;
    assert.equal(retired.state, 'cancelled');
    assert.equal(retired.stateReason, `superseded by run ${live.run.id}`);
  } finally {
    fx.cleanup();
  }
});

test('a run that is reused says which declared inputs this start gave differently', () => {
  const fx = fixture();
  try {
    const first = fx.service.start({ workflowId: 'brief', input: { target: 'docs/a.md', scope: 'security' }, trigger: 'manual' });
    assert.equal(first.run.state, 'ready');
    const second = fx.service.start({ workflowId: 'brief', input: { target: 'docs/a.md', scope: 'cost' }, trigger: 'manual' });
    assert.equal(second.created, false);
    assert.equal(second.run.id, first.run.id);
    assert.deepEqual(second.differs, ['scope']);
    assert.ok(second.preflight.flags.includes(differsFlag(first.run.id, ['scope'])));
    assert.match(differsFlag(first.run.id, ['scope']), /^run run-\d+ already covers this work but was started with a different scope; carry on with it, or cancel it and start again to use the new values$/);
    assert.deepEqual(second.run.input, { target: 'docs/a.md', scope: 'security' }, 'the run keeps the input it was started with');
    assert.equal(second.preflight.status, 'runnable', 'the preflight is the existing run’s own');

    const same = fx.service.start({ workflowId: 'brief', input: { scope: 'security', target: 'docs/a.md' }, trigger: 'manual' });
    assert.deepEqual(same.differs, [], 'key order does not make a difference');
    const dropped = fx.service.start({ workflowId: 'brief', input: { target: 'docs/a.md' }, trigger: 'manual' });
    assert.deepEqual(dropped.differs, ['scope'], 'leaving an input out differs from giving it');
    assert.match(differsFlag('run-9', ['scope', 'target', 'audience']), /a different scope, target and audience;/);
  } finally {
    fx.cleanup();
  }
});

test('through the tools: a claim on a blocked run says why, the corrected start replaces it, and a reused run asks the person about what differs', async () => {
  const fx = brokerFixture();
  try {
    const wrong = await call(fx, 'start_outcome', { workflowId: 'managed-outcome', input: { request: 'brief on revenue risk', dateRange: '2026-07-01..2026-09-30' } });
    assert.equal(wrong.run.state, 'blocked');
    assert.equal(wrong.superseded, null);
    assert.deepEqual(wrong.differs, []);
    const told = await call(fx, 'claim_work', { runId: wrong.run.id });
    assert.equal(told.work, null);
    assert.equal(told.waitingOn.kind, 'blocked');
    assert.ok(told.waitingOn.reasons.some((r: { message: string; remedy: string }) => r.message.includes('dateRange') && r.remedy.length > 0));

    const fixed = await call(fx, 'start_outcome', { workflowId: 'managed-outcome', input: { request: 'brief on revenue risk' } });
    assert.equal(fixed.created, true);
    assert.equal(fixed.run.state, 'ready');
    assert.equal(fixed.superseded, wrong.run.id);
    assert.equal(fixed.next, undefined);
    const work = await call(fx, 'claim_work', { runId: fixed.run.id });
    assert.ok(work.work, 'the corrected run hands out work');

    const brief = await call(fx, 'start_outcome', { workflowId: 'research-brief', input: { question: 'Why did churn rise?', scope: 'enterprise' } });
    assert.equal(brief.created, true);
    const reused = await call(fx, 'start_outcome', { workflowId: 'research-brief', input: { question: 'Why did churn rise?', scope: 'self-serve' } });
    assert.equal(reused.created, false);
    assert.equal(reused.run.id, brief.run.id);
    assert.deepEqual(reused.differs, ['scope']);
    assert.equal(reused.next, 'Tell the person this work is already running with different scope, and ask whether to carry on with it or cancel it and start again.');
    assert.ok(reused.preflight.flags.includes(differsFlag(brief.run.id, ['scope'])));
  } finally {
    fx.cleanup();
  }
});

test('the tool descriptions say what a blocked start and a blocked claim give back', () => {
  const start = TOOLS.find((t) => t.name === 'start_outcome')!;
  assert.doesNotMatch(start.description, /half-started/);
  assert.match(start.description, /starting again after the fix replaces it, or with unchanged input checks it again/);
  assert.match(TOOLS.find((t) => t.name === 'claim_work')!.description, /A blocked run comes back with its reasons and what would unblock it\./);
});
