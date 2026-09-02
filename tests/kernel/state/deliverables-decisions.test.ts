/**
 * tests/kernel/state/deliverables-decisions.test.ts — a finished step leaves a
 * draft; only a recorded judgment moves trust. Decisions resolve once.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun } from '../../../src/kernel/state/runs.ts';
import { addStep, claimStep, completeStep } from '../../../src/kernel/state/steps.ts';
import {
  upsertDraft, getDeliverable, setTrustState, listDeliverables, TRUST_TRANSITIONS,
} from '../../../src/kernel/state/deliverables.ts';
import {
  raiseDecision, resolveDecision, withdrawDecision, listOpenDecisions,
} from '../../../src/kernel/state/decisions.ts';
import { IllegalTransitionError } from '../../../src/kernel/state/rows.ts';
import { listActivity } from '../../../src/kernel/state/activity.ts';
import { freshStore, clock } from './support.ts';

function seedRun(store: ReturnType<typeof freshStore>['store'], at: () => string): void {
  createRun(store, {
    id: 'run-1', workflowId: 'w', workflowVersion: '1.0.0', interactionClass: 'manage', triggerKind: 'manual',
    idempotencyKey: 'k', executorKind: 'interactive', executorId: 'session', input: {}, at: at(),
  });
}

test('step success leaves the deliverable a draft; trust moves only by judgment', () => {
  const fx = freshStore();
  try {
    const at = clock();
    seedRun(fx.store, at);
    addStep(fx.store, { id: 's-1', runId: 'run-1', stepId: 'write', ordinal: 0, permissionTier: 'draft', ready: true, at: at() });
    const lease = claimStep(fx.store, { owner: 'w', now: at(), leaseUntil: '2026-09-02T12:00:00.000Z' })!;
    upsertDraft(fx.store, { id: 'd-1', runId: 'run-1', stepRunId: 's-1', kind: 'review', body: { text: 'v1' }, at: at() });
    completeStep(fx.store, { id: 's-1', owner: 'w', token: lease.token, at: at(), output: { deliverableId: 'd-1' } });
    assert.equal(getDeliverable(fx.store, 'd-1')?.trustState, 'draft');

    assert.throws(() => setTrustState(fx.store, { id: 'd-1', trustState: 'final', actor: 'bot', at: at() }), IllegalTransitionError);
    setTrustState(fx.store, { id: 'd-1', trustState: 'validated', actor: 'validator:schema', at: at(), verification: { schema: 'ok' } });
    setTrustState(fx.store, { id: 'd-1', trustState: 'challenged', actor: 'adversarial-review', at: at(), verification: { verdict: 'needs validation' } });
    setTrustState(fx.store, { id: 'd-1', trustState: 'accepted', actor: 'gerald', at: at(), reason: 'looks right' });
    const final = setTrustState(fx.store, { id: 'd-1', trustState: 'final', actor: 'gerald', at: at() });
    assert.equal(final.trustState, 'final');
    assert.deepEqual(final.verification, { verdict: 'needs validation' });
    assert.deepEqual(TRUST_TRANSITIONS.final, []);
    assert.throws(() => upsertDraft(fx.store, { id: 'd-1', runId: 'run-1', kind: 'review', body: { text: 'v2' }, at: at() }), /only a draft or rejected/);

    const trustEvents = listActivity(fx.store, { runId: 'run-1' }).filter((e) => e.kind === 'deliverable.trust');
    assert.deepEqual(trustEvents.map((e) => e.actor), ['validator:schema', 'adversarial-review', 'gerald', 'gerald']);
  } finally {
    fx.cleanup();
  }
});

test('a rejected deliverable can be redrafted; one deliverable per step', () => {
  const fx = freshStore();
  try {
    const at = clock();
    seedRun(fx.store, at);
    addStep(fx.store, { id: 's-1', runId: 'run-1', stepId: 'write', ordinal: 0, permissionTier: 'draft', ready: true, at: at() });
    upsertDraft(fx.store, { id: 'd-1', runId: 'run-1', stepRunId: 's-1', kind: 'review', body: { text: 'v1' }, at: at() });
    setTrustState(fx.store, { id: 'd-1', trustState: 'rejected', actor: 'gerald', at: at() });
    const redrafted = upsertDraft(fx.store, { id: 'd-1', runId: 'run-1', stepRunId: 's-1', kind: 'review', body: { text: 'v2' }, at: at() });
    assert.equal(redrafted.trustState, 'draft');
    assert.deepEqual(redrafted.body, { text: 'v2' });
    assert.throws(
      () => upsertDraft(fx.store, { id: 'd-2', runId: 'run-1', stepRunId: 's-1', kind: 'review', body: {}, at: at() }),
      /UNIQUE/,
    );
    assert.equal(listDeliverables(fx.store, 'run-1').length, 1);
  } finally {
    fx.cleanup();
  }
});

test('decisions open once, resolve once, honor their options, and can be withdrawn', () => {
  const fx = freshStore();
  try {
    const at = clock();
    seedRun(fx.store, at);
    raiseDecision(fx.store, { id: 'q-1', kind: 'approval', question: 'Apply the Jira change PROJ-1?', runId: 'run-1', options: ['apply', 'skip'], at: at() });
    raiseDecision(fx.store, { id: 'q-2', kind: 'clarification', question: 'Which principle governs caching?', runId: 'run-1', at: at() });
    assert.deepEqual(listOpenDecisions(fx.store, 'run-1').map((d) => d.id), ['q-1', 'q-2']);

    assert.throws(() => resolveDecision(fx.store, { id: 'q-1', resolution: 'maybe', by: 'gerald', at: at() }), /is not one of them/);
    const resolved = resolveDecision(fx.store, { id: 'q-1', resolution: 'apply', by: 'gerald', at: at() });
    assert.equal(resolved.state, 'resolved');
    assert.equal(resolved.resolvedBy, 'gerald');
    assert.throws(() => resolveDecision(fx.store, { id: 'q-1', resolution: 'skip', by: 'gerald', at: at() }), IllegalTransitionError);

    const withdrawn = withdrawDecision(fx.store, { id: 'q-2', reason: 'answered by the constitution', at: at() });
    assert.equal(withdrawn.state, 'withdrawn');
    assert.equal(listOpenDecisions(fx.store).length, 0);
  } finally {
    fx.cleanup();
  }
});
