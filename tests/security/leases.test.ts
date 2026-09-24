/**
 * tests/security/leases.test.ts — a step lease is proved with a secret only
 * the claiming session holds.
 *
 * The token claim_work returns is a random value, not the attempt number
 * anyone can read. Only the session that claimed the step, holding that
 * token, can submit or extend it; another session that learns the token still
 * cannot, because the holder is the calling session, not a name the caller
 * supplies. The secret never lands in the activity record, and a session that
 * keeps calling keeps its long leases.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrokerContext, type BrokerBinding } from '../../src/cli/broker-context.ts';
import { toolsFor } from '../../src/kernel/broker/tools.ts';
import type { BrokerContext } from '../../src/kernel/broker/context.ts';
import { addStep, claimStep, getStep, renewExecutorLeases } from '../../src/kernel/state/steps.ts';
import { createRun } from '../../src/kernel/state/runs.ts';
import { brokerFixture } from '../kernel/broker/support.ts';

async function call(ctx: BrokerContext, name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = toolsFor('interactive').find((t) => t.name === name)!;
  return tool.run(ctx, tool.validate(args));
}

function secondSession(fx: ReturnType<typeof brokerFixture>): BrokerContext {
  const binding: BrokerBinding = { client: 'cursor', surface: 'interactive', sessionId: 'ses_other', executorId: 'session:cursor:ses_other', actor: 'model via cursor' };
  const project = { root: fx.broker.root, layout: fx.broker.layout, files: fx.broker.files, store: fx.broker.store, lane: null };
  return createBrokerContext(fx.ctx, project, binding);
}

test('a lease is proved by its secret and its session, never by the attempt number or a claimed name', async () => {
  const fx = brokerFixture();
  try {
    const started = (await call(fx.broker, 'start_outcome', { workflowId: 'design-conformance', input: { target: 'src/kernel/state' } })) as { run: { id: string } };
    const claimed = (await call(fx.broker, 'claim_work', { runId: started.run.id })) as { work: { stepRunId: string; owner: string; token: string } };
    assert.match(claimed.work.token, /^[0-9a-f-]{36}$/, 'the token is a random secret');
    const attempt = String(getStep(fx.broker.store, claimed.work.stepRunId)!.attempts);
    await assert.rejects(call(fx.broker, 'submit_work', { stepRunId: claimed.work.stepRunId, token: attempt, output: {} }), /not held by this session/);

    const other = secondSession(fx);
    await assert.rejects(
      call(other, 'submit_work', { stepRunId: claimed.work.stepRunId, owner: claimed.work.owner, token: claimed.work.token, output: {} }),
      /not held by this session/,
      'a session that learned the token still cannot submit another session’s step',
    );
    await assert.rejects(call(other, 'heartbeat', { stepRunId: claimed.work.stepRunId, token: claimed.work.token }), /not held by this session/);

    const beat = (await call(fx.broker, 'heartbeat', { stepRunId: claimed.work.stepRunId, token: claimed.work.token })) as { leaseUntil: string };
    assert.ok(beat.leaseUntil > fx.broker.now(), 'the interactive session keeps its own lease alive');

    const activity = (fx.broker.store.db.prepare('SELECT payload_json FROM activity_events').all() as Array<{ payload_json: string }>).map((r) => r.payload_json).join('\n');
    assert.doesNotMatch(activity, new RegExp(claimed.work.token));
  } finally {
    fx.cleanup();
  }
});

test('a session that keeps calling has its leases extended past half their term', () => {
  const fx = brokerFixture();
  try {
    const store = fx.broker.store;
    createRun(store, { workflowId: 'design-conformance', workflowVersion: '1.0.0', interactionClass: 'manage', triggerKind: 'manual', executorKind: 'interactive', executorId: 'session:claude-code', input: {}, id: 'run-l', idempotencyKey: 'k-l', at: '2026-09-24T12:00:00.000Z' });
    addStep(store, { id: 's-l', runId: 'run-l', stepId: 'a', ordinal: 0, permissionTier: 'draft', ready: true, at: '2026-09-24T12:00:00.000Z' });
    claimStep(store, { owner: 'session:claude-code', now: '2026-09-24T12:00:00.000Z', leaseUntil: '2026-09-24T12:30:00.000Z', runId: 'run-l' });
    assert.equal(renewExecutorLeases(store, { owner: 'session:claude-code', now: '2026-09-24T12:05:00.000Z', termMs: 30 * 60_000 }), 0, 'not yet halfway');
    assert.equal(renewExecutorLeases(store, { owner: 'session:claude-code', now: '2026-09-24T12:20:00.000Z', termMs: 30 * 60_000 }), 1);
    assert.equal(getStep(store, 's-l')!.leaseUntil, '2026-09-24T12:50:00.000Z');
    assert.equal(renewExecutorLeases(store, { owner: 'session:cursor:ses_other', now: '2026-09-24T12:20:00.000Z', termMs: 30 * 60_000 }), 0, 'another executor’s call renews nothing it does not hold');
  } finally {
    fx.cleanup();
  }
});

test('claiming a step and walking away cannot fail it for everyone else', () => {
  const fx = brokerFixture();
  try {
    const store = fx.broker.store;
    createRun(store, { workflowId: 'design-conformance', workflowVersion: '1.0.0', interactionClass: 'manage', triggerKind: 'manual', executorKind: 'interactive', executorId: 'session:claude-code', input: {}, id: 'run-d', idempotencyKey: 'k-d', at: '2026-09-24T12:00:00.000Z' });
    addStep(store, { id: 's-d', runId: 'run-d', stepId: 'a', ordinal: 0, permissionTier: 'draft', ready: true, maxAttempts: 1, at: '2026-09-24T12:00:00.000Z' });
    claimStep(store, { owner: 'session:claude-code:ses_careless', now: '2026-09-24T12:00:00.000Z', leaseUntil: '2026-09-24T12:01:00.000Z', runId: 'run-d' });
    const next = claimStep(store, { owner: 'session:cursor:ses_other', now: '2026-09-24T12:02:00.000Z', leaseUntil: '2026-09-24T12:03:00.000Z', runId: 'run-d' });
    assert.ok(next, 'the abandoned lease expired and the step went to the next session');
    assert.equal(getStep(store, 's-d')!.state, 'leased');
  } finally {
    fx.cleanup();
  }
});
