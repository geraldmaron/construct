/**
 * tests/workplace-loop/propose.test.mjs — unit coverage for
 * lib/workplace-loop/propose.mjs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildProposal } from '../../lib/workplace-loop/propose.mjs';

function alignedSignal(overrides = {}) {
  return {
    id: 'SIG-1',
    type: 'stale_issue',
    severity: 'medium',
    summary: 'GH-1 is stale.',
    sources: [{ kind: 'github', repo: 'o/r', ref: '#1' }],
    alignment: { verdict: 'aligned', pillar: null, rationale: 'n/a' },
    ...overrides,
  };
}

test('buildProposal returns null when no signal is actionable — no fabricated proposal', () => {
  const proposal = buildProposal({ signals: [alignedSignal()], runNumber: 1 });
  assert.equal(proposal, null);
});

test('buildProposal proposes an effect for a conflict-verdict signal', () => {
  const signal = alignedSignal({ alignment: { verdict: 'conflict', pillar: 'Reliability', rationale: 'blocks a pillar' } });
  const proposal = buildProposal({ signals: [signal], runNumber: 1 });
  assert.ok(proposal);
  assert.equal(proposal.proposalId, 'PROP-1');
  assert.equal(proposal.status, 'pending_approval');
  assert.equal(proposal.proposedExternalEffects.length, 1);
  assert.equal(proposal.proposedExternalEffects[0].providerId, 'github');
  assert.equal(proposal.proposedExternalEffects[0].writeKind, 'comment');
  assert.equal(proposal.proposedExternalEffects[0].payload.issue_number, 1);
});

test('buildProposal proposes an effect for an unowned_risk_issue regardless of alignment verdict', () => {
  const signal = alignedSignal({
    type: 'unowned_risk_issue',
    alignment: { verdict: 'no_strategy_configured', pillar: null, rationale: 'n/a' },
  });
  const proposal = buildProposal({ signals: [signal], runNumber: 2 });
  assert.ok(proposal);
  assert.equal(proposal.proposedExternalEffects.length, 1);
});

test('buildProposal cites every actionable signal source, deduplicated', () => {
  const signal = alignedSignal({ alignment: { verdict: 'conflict', pillar: 'P', rationale: 'r' } });
  const proposal = buildProposal({ signals: [signal], runNumber: 1 });
  assert.deepEqual(proposal.brief.cites, ['github:o/r#1']);
});

test('buildProposal contentHash is stable for the same input and changes when effects change', () => {
  const signal = alignedSignal({ alignment: { verdict: 'conflict', pillar: 'P', rationale: 'r' } });
  const a = buildProposal({ signals: [signal], runNumber: 1 });
  const b = buildProposal({ signals: [signal], runNumber: 1, asOf: '2099-01-01T00:00:00Z' });
  assert.equal(a.contentHash, b.contentHash, 'timestamp must not affect the content hash — only the effects/signals do');

  const differentSignal = alignedSignal({ id: 'SIG-2', alignment: { verdict: 'conflict', pillar: 'P', rationale: 'r' } });
  const c = buildProposal({ signals: [differentSignal], runNumber: 1 });
  assert.notEqual(a.contentHash, c.contentHash);
});
