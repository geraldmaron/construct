/**
 * tests/workplace-loop/verify.test.mjs — unit coverage for
 * lib/workplace-loop/verify.mjs (construct-b0nny.25).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ApprovalQueue } from '../../lib/embed/approval-queue.mjs';
import { requestApproval, approveAll, applyProposal } from '../../lib/workplace-loop/gate.mjs';
import { verifyProposalExecution } from '../../lib/workplace-loop/verify.mjs';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-workplace-verify-'));
  dirs.push(dir);
  return { dir, queue: new ApprovalQueue({ persistPath: path.join(dir, 'queue.jsonl') }) };
}

test('verifyProposalExecution reports INCOMPLETE before any effect executes', () => {
  const proposal = proposalWithOneEffect();
  const { queue } = tmpQueue();
  const records = requestApproval(proposal, queue);
  const result = verifyProposalExecution(proposal, records, queue);
  assert.equal(result.result, 'INCOMPLETE');
  assert.equal(result.contentHashMatch, true);
});

test('verifyProposalExecution reports MATCH once every effect has executed cleanly', async () => {
  const proposal = proposalWithOneEffect();
  const { dir, queue } = tmpQueue();
  const records = requestApproval(proposal, queue);
  approveAll(records, queue, { userId: 'priya-nair' });
  await applyProposal(records, queue, {
    rootDir: dir,
    adapterFactories: { github: () => ({ meta: { id: 'github' }, write: async () => ({ type: 'comment-created' }) }) },
  });

  const result = verifyProposalExecution(proposal, records, queue);
  assert.equal(result.result, 'MATCH');
  assert.equal(result.effects[0].executed, true);
});

test('verifyProposalExecution reports DRIFTED when the proposal content no longer matches its own stored hash', () => {
  const proposal = proposalWithOneEffect();
  const { queue } = tmpQueue();
  const records = requestApproval(proposal, queue);
  const tampered = { ...proposal, proposedExternalEffects: [{ ...proposal.proposedExternalEffects[0], payload: { issue_number: 999 } }] };
  const result = verifyProposalExecution(tampered, records, queue);
  assert.equal(result.result, 'DRIFTED');
  assert.equal(result.contentHashMatch, false);
});
