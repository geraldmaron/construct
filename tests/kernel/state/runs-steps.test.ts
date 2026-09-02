/**
 * tests/kernel/state/runs-steps.test.ts — runs are idempotent and move only
 * along the table; steps are leased with fencing, retried by policy, and
 * every attempt is recorded.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRun, getRun, transitionRun, listActiveRuns, RUN_STATES, RUN_TRANSITIONS,
} from '../../../src/kernel/state/runs.ts';
import {
  addStep, claimStep, completeStep, failStep, getStep, listAttempts, transitionStep,
  countStepsByState, StaleLeaseError, STEP_TRANSITIONS,
} from '../../../src/kernel/state/steps.ts';
import { IllegalTransitionError } from '../../../src/kernel/state/rows.ts';
import { listActivity } from '../../../src/kernel/state/activity.ts';
import { freshStore, clock } from './support.ts';

const base = {
  workflowId: 'design-conformance', workflowVersion: '1.0.0', interactionClass: 'manage' as const,
  triggerKind: 'manual' as const, executorKind: 'interactive' as const, executorId: 'session:claude',
  input: { target: 'feature-x' },
};

test('the same idempotency key yields one run', () => {
  const fx = freshStore();
  try {
    const at = clock();
    const first = createRun(fx.store, { ...base, id: 'run-1', idempotencyKey: 'k1', at: at() });
    const second = createRun(fx.store, { ...base, id: 'run-2', idempotencyKey: 'k1', at: at() });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.run.id, 'run-1');
    assert.equal(first.run.state, 'preflight');
    assert.equal(getRun(fx.store, 'run-2'), null);
    assert.equal(listActivity(fx.store).filter((e) => e.kind === 'run.created').length, 1);
  } finally {
    fx.cleanup();
  }
});

test('run transitions follow the table and terminal states never move', () => {
  const fx = freshStore();
  try {
    const at = clock();
    createRun(fx.store, { ...base, id: 'run-1', idempotencyKey: 'k1', at: at() });
    assert.throws(() => transitionRun(fx.store, { id: 'run-1', to: 'running', at: at() }), IllegalTransitionError);
    transitionRun(fx.store, { id: 'run-1', to: 'blocked', at: at(), reason: 'source stale' });
    transitionRun(fx.store, { id: 'run-1', to: 'ready', at: at(), preflight: { ok: true } });
    transitionRun(fx.store, { id: 'run-1', to: 'running', at: at() });
    transitionRun(fx.store, { id: 'run-1', to: 'waiting_for_decision', at: at() });
    transitionRun(fx.store, { id: 'run-1', to: 'running', at: at() });
    const done = transitionRun(fx.store, { id: 'run-1', to: 'succeeded', at: at() });
    assert.ok(done.finishedAt);
    assert.deepEqual(done.preflight, { ok: true });
    for (const to of RUN_STATES) {
      assert.throws(() => transitionRun(fx.store, { id: 'run-1', to, at: at() }), IllegalTransitionError);
    }
    assert.equal(listActiveRuns(fx.store).length, 0);
    for (const terminal of ['succeeded', 'failed', 'cancelled'] as const) {
      assert.deepEqual(RUN_TRANSITIONS[terminal], []);
    }
  } finally {
    fx.cleanup();
  }
});

test('every run state either reaches a terminal state or is one', () => {
  for (const state of RUN_STATES) {
    const seen = new Set<string>();
    const queue = [state];
    while (queue.length) {
      const s = queue.pop()!;
      if (seen.has(s)) continue;
      seen.add(s);
      queue.push(...RUN_TRANSITIONS[s as keyof typeof RUN_TRANSITIONS]);
    }
    assert.ok(['succeeded', 'failed', 'cancelled'].some((t) => seen.has(t)), `${state} can never finish`);
  }
  for (const state of Object.keys(STEP_TRANSITIONS) as Array<keyof typeof STEP_TRANSITIONS>) {
    assert.ok(Array.isArray(STEP_TRANSITIONS[state]));
  }
});

test('steps are leased in order with a fencing token; a stale holder cannot settle', () => {
  const fx = freshStore();
  try {
    const at = clock();
    createRun(fx.store, { ...base, id: 'run-1', idempotencyKey: 'k1', at: at() });
    addStep(fx.store, { id: 's-b', runId: 'run-1', stepId: 'review', ordinal: 1, permissionTier: 'draft', ready: true, at: at() });
    addStep(fx.store, { id: 's-a', runId: 'run-1', stepId: 'read', ordinal: 0, permissionTier: 'observe', ready: true, maxAttempts: 3, at: at() });

    const t0 = at();
    const lease1 = claimStep(fx.store, { owner: 'w1', now: t0, leaseUntil: '2026-09-02T10:00:30.000Z', runId: 'run-1' });
    assert.equal(lease1?.stepId, 'read');
    assert.equal(lease1?.token, 1);

    // Lease expires; another worker takes over with a new token.
    const lease2 = claimStep(fx.store, { owner: 'w2', now: '2026-09-02T10:00:31.000Z', leaseUntil: '2026-09-02T10:01:00.000Z', runId: 'run-1' });
    assert.equal(lease2?.id, 's-a');
    assert.equal(lease2?.token, 2);

    assert.throws(
      () => completeStep(fx.store, { id: 's-a', owner: 'w1', token: 1, at: '2026-09-02T10:00:40.000Z', output: { late: true } }),
      StaleLeaseError,
    );
    const done = completeStep(fx.store, { id: 's-a', owner: 'w2', token: 2, at: '2026-09-02T10:00:45.000Z', output: { ok: true } });
    assert.equal(done.state, 'succeeded');
    assert.deepEqual(done.output, { ok: true });
    assert.equal(done.leaseOwner, null);

    const attempts = listAttempts(fx.store, 's-a');
    assert.deepEqual(attempts.map((a) => [a.attempt, a.owner, a.outcome]), [[1, 'w1', 'expired'], [2, 'w2', 'succeeded']]);

    // The next claim is the second step; the finished one is not re-leased.
    const next = claimStep(fx.store, { owner: 'w2', now: '2026-09-02T10:00:50.000Z', leaseUntil: '2026-09-02T10:02:00.000Z' });
    assert.equal(next?.stepId, 'review');
  } finally {
    fx.cleanup();
  }
});

test('failing an attempt retries until max attempts, then fails for good', () => {
  const fx = freshStore();
  try {
    const at = clock();
    createRun(fx.store, { ...base, id: 'run-1', idempotencyKey: 'k1', at: at() });
    addStep(fx.store, { id: 's-a', runId: 'run-1', stepId: 'fetch', ordinal: 0, permissionTier: 'observe', ready: true, maxAttempts: 2, at: at() });

    const l1 = claimStep(fx.store, { owner: 'w', now: at(), leaseUntil: '2026-09-02T11:00:00.000Z' })!;
    const afterFirst = failStep(fx.store, { id: 's-a', owner: 'w', token: l1.token, at: at(), error: { code: 'ETIMEDOUT' }, reason: 'timeout' });
    assert.equal(afterFirst.state, 'ready');

    const l2 = claimStep(fx.store, { owner: 'w', now: at(), leaseUntil: '2026-09-02T11:00:00.000Z' })!;
    assert.equal(l2.token, 2);
    const afterSecond = failStep(fx.store, { id: 's-a', owner: 'w', token: l2.token, at: at(), error: { code: 'ETIMEDOUT' }, reason: 'timeout again' });
    assert.equal(afterSecond.state, 'failed');
    assert.equal(afterSecond.stateReason, 'timeout again');
    assert.ok(afterSecond.finishedAt);

    assert.equal(claimStep(fx.store, { owner: 'w', now: at(), leaseUntil: '2026-09-02T11:00:00.000Z' }), null);
    assert.deepEqual(listAttempts(fx.store, 's-a').map((a) => a.outcome), ['failed', 'failed']);
    assert.equal(countStepsByState(fx.store, 'run-1').failed, 1);
  } finally {
    fx.cleanup();
  }
});

test('a pending step is not claimable until made ready; skips and cancels are terminal', () => {
  const fx = freshStore();
  try {
    const at = clock();
    createRun(fx.store, { ...base, id: 'run-1', idempotencyKey: 'k1', at: at() });
    addStep(fx.store, { id: 's-a', runId: 'run-1', stepId: 'later', ordinal: 0, permissionTier: 'observe', at: at() });
    assert.equal(claimStep(fx.store, { owner: 'w', now: at(), leaseUntil: '2026-09-02T11:00:00.000Z' }), null);
    transitionStep(fx.store, { id: 's-a', to: 'ready', at: at() });
    const lease = claimStep(fx.store, { owner: 'w', now: at(), leaseUntil: '2026-09-02T11:00:00.000Z' });
    assert.equal(lease?.id, 's-a');
    // Pausing for a decision releases the lease and closes the attempt as paused.
    transitionStep(fx.store, { id: 's-a', to: 'waiting_for_decision', at: at(), reason: 'needs approval' });
    assert.equal(getStep(fx.store, 's-a')?.leaseOwner, null);
    assert.equal(listAttempts(fx.store, 's-a')[0]?.outcome, 'paused');
    transitionStep(fx.store, { id: 's-a', to: 'cancelled', at: at() });
    assert.throws(() => transitionStep(fx.store, { id: 's-a', to: 'ready', at: at() }), IllegalTransitionError);
    assert.throws(
      () => addStep(fx.store, { id: 's-dup', runId: 'run-1', stepId: 'later', ordinal: 1, permissionTier: 'observe', at: at() }),
      /UNIQUE/,
    );
  } finally {
    fx.cleanup();
  }
});

test('inputs are validated before they reach SQL', () => {
  const fx = freshStore();
  try {
    const at = clock();
    assert.throws(() => createRun(fx.store, { ...base, id: 'r', idempotencyKey: 'k', at: 'yesterday' }), /ISO-8601/);
    assert.throws(
      () => createRun(fx.store, { ...base, interactionClass: 'answer' as never, id: 'r', idempotencyKey: 'k', at: at() }),
      /interactionClass must be one of/,
    );
    createRun(fx.store, { ...base, id: 'r', idempotencyKey: 'k', at: at() });
    assert.throws(
      () => addStep(fx.store, { id: 's', runId: 'r', stepId: 'x', ordinal: 0, permissionTier: 'bypass' as never, at: at() }),
      /permissionTier must be one of/,
    );
    assert.throws(
      () => claimStep(fx.store, { owner: 'w', now: '2026-09-02T10:00:10.000Z', leaseUntil: '2026-09-02T10:00:00.000Z' }),
      /leaseUntil must be after/,
    );
  } finally {
    fx.cleanup();
  }
});
