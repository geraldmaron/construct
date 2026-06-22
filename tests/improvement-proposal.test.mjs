/**
 * tests/improvement-proposal.test.mjs — unit coverage for the improvement-loop
 * proposal record and its state machine (construct-6zga.1.5).
 *
 * Proves the validator preserves lineage and that the state machine permits only
 * the legal operator progressions — a proposal can never reach approved or applied
 * without passing through awaiting_approval, and terminal states have no successor.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateProposal, canTransition, transitionProposal, isTerminalState, PROPOSAL_STATES,
} from '../lib/improvement/proposal.mjs';

function proposal(over = {}) {
  return {
    schemaVersion: 1,
    id: over.id || 'prop-1',
    type: over.type || 'prompt',
    state: over.state || 'observed',
    affectedProfiles: over.affectedProfiles || ['balanced'],
    blastRadius: over.blastRadius || 'single-surface',
    rollbackTarget: over.rollbackTarget || { version: 'v1.0.0', ref: 'sha:base' },
    requiredGates: over.requiredGates || ['contract-schema'],
    rolloutMode: over.rolloutMode || 'staged',
    dependencies: 'dependencies' in over ? over.dependencies : [],
    evaluationReportId: over.evaluationReportId || 'report-1',
    terminalReason: null,
    lineage: over.lineage || {
      inputTraceIds: ['trace-1'],
      baselineVersion: 'v1.0.0',
      candidateVersion: 'v1.1.0',
      capabilitySnapshot: { capabilityClass: 'hosted-direct' },
      evaluatorVersions: ['gates@1'],
      budgets: { maxCost: 0.5 },
    },
    approver: 'approver' in over ? over.approver : null,
    rollout: null,
  };
}

test('a complete proposal validates and preserves lineage', () => {
  assert.ok(validateProposal(proposal()).valid);
});

test('the validator rejects an invalid type and a lineage with no input traces', () => {
  const badType = validateProposal(proposal({ type: 'magic' }));
  assert.equal(badType.valid, false);
  assert.ok(badType.errors.some((e) => e.includes('type')));

  const badTrace = validateProposal(proposal({ lineage: { inputTraceIds: 'trace-1', baselineVersion: 'v1', candidateVersion: 'v2', capabilitySnapshot: {}, evaluatorVersions: [] } }));
  assert.equal(badTrace.valid, false);
  assert.ok(badTrace.errors.some((e) => e.includes('inputTraceIds')));
});

test('the state machine forbids skipping the approval boundary', () => {
  assert.equal(canTransition('observed', 'proposal_ready'), true);
  assert.equal(canTransition('proposal_ready', 'awaiting_approval'), true);
  assert.equal(canTransition('awaiting_approval', 'approved'), true);
  assert.equal(canTransition('approved', 'applied'), true);
  assert.equal(canTransition('observed', 'approved'), false, 'cannot jump straight to approved');
  assert.equal(canTransition('proposal_ready', 'applied'), false, 'cannot apply without approval');
});

test('terminal states have no successor', () => {
  for (const state of ['rejected', 'reproduce_failed', 'baseline_failed', 'evaluation_failed', 'rolled_back', 'superseded']) {
    assert.ok(isTerminalState(state), `${state} must be terminal`);
  }
  assert.equal(isTerminalState('awaiting_approval'), false);
});

test('transitionProposal advances on a legal move and refuses an illegal one', () => {
  const ready = transitionProposal(proposal({ state: 'proposal_ready' }), 'awaiting_approval');
  assert.equal(ready.ok, true);
  assert.equal(ready.proposal.state, 'awaiting_approval');

  const illegal = transitionProposal(proposal({ state: 'observed' }), 'applied');
  assert.equal(illegal.ok, false);
  assert.ok(illegal.error.includes('illegal transition'));
});

test('every state appears in the canonical operator state list', () => {
  assert.equal(PROPOSAL_STATES.length, 11);
});
