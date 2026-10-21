import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brokerFixture } from './support.ts';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { listStatements } from '../../../src/kernel/state/profile.ts';
import { listRuns } from '../../../src/kernel/state/runs.ts';
import { deliverableAssurance } from '../../../src/kernel/state/deliverables.ts';
const call = async (fx: ReturnType<typeof brokerFixture>, name: string, args: Record<string, unknown>): Promise<any> => {
  const tool = TOOLS.find((t) => t.name === name)!;
  return tool.run(fx.broker, tool.validate(args));
};

test('a direct reversible task is admitted, claimed and completed without a workflow or remembered statement', async () => {
  const fx = brokerFixture();
  try {
    const before = listStatements(fx.broker.store).length;
    const task = await call(fx, 'work', {
      action: 'add',
      title: 'Fix local wording',
      request: { words: 'Fix this local wording.', stakes: { reversible: true, affects: [] } },
      acceptance: ['Wording is corrected'],
    });
    assert.equal(task.admittedBy, 'request');
    assert.equal(task.premises.request.attestation, 'relayed');
    assert.deepEqual(listRuns(fx.broker.store), []);
    assert.equal(listStatements(fx.broker.store).length, before);
    const claim = await call(fx, 'work', { action: 'claim', id: task.id, paths: ['docs/design.md'] });
    assert.ok(claim.claimToken);
    const done = await call(fx, 'work', {
      action: 'complete',
      id: task.id,
      token: claim.claimToken,
      reason: 'Inspected the corrected wording.',
    });
    assert.equal(done.status, 'completed');
    for (const request of [
      { words: 'x' },
      { words: 'x', stakes: { reversible: false, affects: [] } },
      { words: 'x', stakes: { reversible: true, affects: ['production'] } },
      { words: 'x', stakes: { reversible: true, affects: [] }, approved: true },
    ])
      await assert.rejects(call(fx, 'work', { action: 'add', title: 'No bypass', request }), /request needs/);
    await assert.rejects(
      call(fx, 'work', {
        action: 'add',
        kind: 'outcome',
        title: 'No large bypass',
        request: { words: 'x', stakes: { reversible: true, affects: [] } },
      }),
      /only for a bounded/,
    );
    await assert.rejects(
      call(fx, 'work', { action: 'claim', id: task.id, request: { words: 'x', stakes: { reversible: true, affects: [] } } }),
      /only for add/,
    );
  } finally {
    fx.cleanup();
  }
});

test('check_answer exposes a recoverable bound calculation and never upgrades prose support', async () => {
  const fx = brokerFixture();
  try {
    writeFileSync(join(fx.box.cwd, 'facts.txt'), 'A benefit is $12,000. A cost is $4,000. B cost is $3,000.');
    const answer = 'A net benefit is $8,000.';
    const base = { answer, citations: [{ ref: 'facts.txt' }] };
    const derivation = {
      id: 'net',
      claim: answer,
      value: '8000',
      expression: '12000-4000',
      operands: [
        { value: '12000', ref: 'facts.txt', excerpt: 'A benefit is $12,000.' },
        { value: '4000', ref: 'facts.txt', excerpt: 'A cost is $4,000.' },
      ],
    };
    await assert.rejects(
      call(fx, 'check_answer', { ...base, derivations: [{ value: '8000', expression: '12000-4000' }] }),
      /bound derivation/,
    );
    const good = await call(fx, 'check_answer', { ...base, derivations: [derivation] });
    assert.equal(good.ok, true);
    assert.equal(good.arithmetic.results[0].status, 'checked');
    assert.equal(good.semanticSupportVerified, false);
    const falseLabel = await call(fx, 'check_answer', {
      answer: 'A net benefit is $3,000.',
      citations: base.citations,
      claims: [{ claim: 'A net benefit is $3,000.', refs: ['facts.txt'] }],
    });
    assert.equal(falseLabel.ok, false);
    assert.equal(falseLabel.claimSupport.results[0].status, 'unknown');
    assert.equal(falseLabel.semanticSupportVerified, false);
  } finally {
    fx.cleanup();
  }
});

test('classification selects a runnable compatible carrier once, and preserves an explicit blocked choice', async () => {
  const fx = brokerFixture();
  try {
    const original = fx.broker.workflow.preflight;
    // Model a genuine host execution dependency being unavailable; selection is the real broker implementation.
    fx.broker.workflow.preflight = (id, input, options) => {
      const r = original(id, input, options);
      return id === 'managed-outcome'
        ? { ...r, preflight: { ...r.preflight, status: 'blocked', summary: 'Host project-command execution unavailable' } }
        : r;
    };
    const base = {
      words: 'Produce this local result.',
      kind: 'manage',
      stakes: { reversible: true, affects: [] },
      deliverable: { kind: 'other', describe: 'local artifact' },
      intent: { outcome: 'A local artifact', path: 'implementation' },
    };
    const selected = await call(fx, 'classify_request', base);
    assert.equal(selected.matches[0].workflowId, 'managed-outcome');
    assert.equal(selected.selectedWorkflow.workflowId, 'guided-outcome');
    assert.deepEqual(selected.questions, []);
    assert.match(selected.next, /guided-outcome/);
    const explicit = await call(fx, 'classify_request', { ...base, workflowId: 'managed-outcome' });
    assert.equal(explicit.selectedWorkflow.workflowId, 'managed-outcome');
    assert.equal(explicit.selectedWorkflow.status, 'blocked');
    const exact = await call(fx, 'classify_request', { ...base, deliverable: { kind: 'outcome/managed' } });
    assert.equal(exact.selectedWorkflow.workflowId, 'managed-outcome');
    assert.equal(exact.selectedWorkflow.status, 'blocked');
  } finally {
    fx.cleanup();
  }
});

test('human-facing assurance preserves distinct trust, execution and semantic observations', () => {
  const a = deliverableAssurance({
    trustState: 'validated',
    verification: { assurance: 'structural', executionVerified: false, semanticSupportVerified: false },
  });
  assert.match(a.label, /structural.*execution unverified.*semantic support unverified.*not human accepted/);
  assert.equal(a.humanAccepted, false);
  assert.equal(deliverableAssurance({ trustState: 'accepted', verification: null }).humanAccepted, true);
});
