/**
 * tests/workplace-loop/gate.test.mjs — unit coverage for
 * lib/workplace-loop/gate.mjs (construct-b0nny.25 requirement 3: real M2
 * chokepoint routing). Uses the real ApprovalQueue and the real
 * lib/writes/control-plane.mjs drain — only the destination adapter factory
 * is faked (tests/fakes/fake-jira-transport.mjs's precedent), matching
 * tests/writes/control-plane-execution.functional.test.mjs's own pattern:
 * no fake stands in for the queue or the chokepoint itself.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ApprovalQueue } from '../../lib/embed/approval-queue.mjs';
import { requestApproval, approveAll, applyProposal, recordsForApprovalIds } from '../../lib/workplace-loop/gate.mjs';
import { buildProposal } from '../../lib/workplace-loop/propose.mjs';

function proposalWithOneEffect() {
  const signal = {
    id: 'SIG-1', type: 'unowned_risk_issue', severity: 'high',
    summary: 'GH-9 is unowned and risk-labeled.',
    sources: [{ kind: 'github', repo: 'o/r', ref: '#9' }],
    alignment: { verdict: 'no_strategy_configured', pillar: null, rationale: 'n/a' },
  };
  return buildProposal({ signals: [signal], runNumber: 1 });
}

const dirs = [];
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

function tmpQueue() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-workplace-gate-'));
  dirs.push(dir);
  return { dir, queue: new ApprovalQueue({ persistPath: path.join(dir, 'queue.jsonl') }) };
}

test('requestApproval enqueues one real ApprovalQueue record per proposed effect', () => {
  const proposal = proposalWithOneEffect();
  const { queue } = tmpQueue();
  const records = requestApproval(proposal, queue);
  assert.equal(records.length, 1);
  assert.equal(records[0].state, 'awaiting_approval');
  assert.equal(records[0].toolCall.tool, 'github.comment');
});

test('recordsForApprovalIds recovers enqueued records across a fresh queue handle on the same file', () => {
  const proposal = proposalWithOneEffect();
  const { dir, queue } = tmpQueue();
  const records = requestApproval(proposal, queue);

  const reopened = new ApprovalQueue({ persistPath: path.join(dir, 'queue.jsonl') });
  const recovered = recordsForApprovalIds(records.map((r) => r.approvalId), reopened);
  assert.equal(recovered.length, 1);
});

test('recordsForApprovalIds silently drops an id with no matching record', () => {
  const { queue } = tmpQueue();
  assert.deepEqual(recordsForApprovalIds(['appr-does-not-exist'], queue), []);
});

test('recordsForApprovalIds returns [] for an undefined/absent approvalIds list — a proposal with no request-approval run yet', () => {
  const { queue } = tmpQueue();
  assert.deepEqual(recordsForApprovalIds(undefined, queue), []);
});

test('applyProposal REFUSES when a record has not been approved — mirrors spike D\'s refusal proof', async () => {
  const proposal = proposalWithOneEffect();
  const { queue } = tmpQueue();
  const records = requestApproval(proposal, queue);
  await assert.rejects(() => applyProposal(records, queue), /REFUSED/);
});

test('approveAll requires a named approver — no default identity is fabricated', () => {
  const proposal = proposalWithOneEffect();
  const { queue } = tmpQueue();
  const records = requestApproval(proposal, queue);
  assert.throws(() => approveAll(records, queue, null), /decidedBy must name a real approver/);
  assert.throws(() => approveAll(records, queue, {}), /decidedBy must name a real approver/);
});

test('applyProposal drains through the real control-plane chokepoint once approved, using an injected adapter', async () => {
  const proposal = proposalWithOneEffect();
  const { dir, queue } = tmpQueue();
  const records = requestApproval(proposal, queue);
  approveAll(records, queue, { userId: 'priya-nair' });

  let writeCalls = 0;
  const fakeAdapterFactories = {
    github: () => ({
      meta: { id: 'github' },
      write: async (_config, payload) => { writeCalls += 1; return { type: 'comment-created', issue_number: payload.issue_number }; },
    }),
  };

  const outcomes = await applyProposal(records, queue, { rootDir: dir, adapterFactories: fakeAdapterFactories });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].error, null);
  assert.equal(writeCalls, 1);

  const executed = queue.getById(records[0].approvalId);
  assert.ok(executed.executedAt, 'control-plane must stamp executedAt on the real queue record');
});
