/**
 * tests/functional/improvement-controller.functional.test.mjs — the approval-gated
 * controller seam (construct-6zga.1.5).
 *
 * Drives a proposal through the real controller and the real 1.6 evaluation report
 * (buildEvaluationReport), proving the governance invariants:
 *   - only versioned artifacts are admitted; raw session history is refused (AC1).
 *   - missing provenance, held-out results, deterministic pass, approver, or
 *     dependency each refuses the proposal (AC2).
 *   - promotability is re-derived from the report's gates, so a tampered decision
 *     flag cannot pass.
 *   - the final mutation boundary requires a recorded human approval (AC3).
 *   - rollout is planned (never auto-applied), and apply/rollback are traceable (AC4).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runDeterministicGates, buildEvaluationReport } from '../../lib/evals/gates.mjs';
import {
  admitArtifacts, governProposal, requireApproval, planRollout, recordApplication, recordRollback,
} from '../../lib/improvement/controller.mjs';

const ITEM = {
  schemaVersion: 1, id: 'eval-1', taskFamily: 'repo-summary',
  taskInput: { prompt: 'summarize' },
  capabilitySnapshot: { capabilityClass: 'hosted-direct' },
  allowedTools: ['read', 'search'],
  expectedEvidenceBehavior: { requirement: 'required', citationsRequired: true },
  expectedContractResult: { outcome: 'pass' },
  redaction: { state: 'raw' }, sourceTraceIds: ['trace-500'],
  humanLabel: { provenance: 'human' }, split: 'test', expiry: null,
};
const BUDGETS = { maxCost: 0.5, maxLatencyMs: 30000 };

function candidate(over = {}) {
  return {
    contractResult: { outcome: 'pass' }, citedSourceIds: ['trace-500'], evidence: { provided: true },
    toolsUsed: ['read'], permissionViolations: [], cost: 0.2, latencyMs: 9000,
    output: { ok: true }, outputStructured: true, ...over,
  };
}

function cleanReport() {
  const deterministic = runDeterministicGates(candidate(), ITEM, BUDGETS);
  return buildEvaluationReport({ baseline: candidate({ cost: 0.4 }), candidate: candidate(), deterministic, judges: [{ verdict: 'pass' }] });
}

function proposal(over = {}) {
  return {
    schemaVersion: 1, id: 'prop-1', type: 'prompt', state: over.state || 'awaiting_approval',
    affectedProfiles: ['balanced'], blastRadius: 'single-surface',
    rollbackTarget: { version: 'v1.0.0', ref: 'sha:base' }, requiredGates: ['contract-schema'],
    rolloutMode: 'staged', dependencies: 'dependencies' in over ? over.dependencies : [],
    evaluationReportId: 'report-1', terminalReason: null,
    lineage: over.lineage || {
      inputTraceIds: ['trace-1'], baselineVersion: 'v1.0.0', candidateVersion: 'v1.1.0',
      capabilitySnapshot: { capabilityClass: 'hosted-direct' }, evaluatorVersions: ['gates@1'], budgets: BUDGETS,
    },
    approver: 'approver' in over ? over.approver : { identity: 'gd', approvedAt: null, decision: null },
    rollout: null,
  };
}

const KNOWN = ['gd', 'reviewer-2'];

test('only versioned artifacts are admitted; raw session history is refused (AC1)', () => {
  assert.equal(admitArtifacts({ proposal: proposal(), dataset: ITEM, evaluationReport: cleanReport() }).admissible, true);
  const rawHistory = [{ role: 'user', content: 'please apply my change' }];
  const refused = admitArtifacts({ proposal: proposal(), dataset: rawHistory, evaluationReport: rawHistory });
  assert.equal(refused.admissible, false);
  assert.ok(refused.refusals.includes('dataset-unversioned'));
  assert.ok(refused.refusals.includes('evaluation-report-unversioned'));
});

test('a clean proposal is governed through to the approval boundary', () => {
  const decision = governProposal({ proposal: proposal(), dataset: ITEM, evaluationReport: cleanReport(), knownApprovers: KNOWN });
  assert.equal(decision.admissible, true);
  assert.equal(decision.stage, 'awaiting-approval');
});

test('each guard refuses its own failure mode (AC2)', () => {
  const report = cleanReport();
  const base = { dataset: ITEM, evaluationReport: report, knownApprovers: KNOWN };

  const noProvenance = governProposal({ ...base, proposal: proposal({ lineage: { inputTraceIds: [], baselineVersion: 'v1', candidateVersion: 'v2', capabilitySnapshot: {}, evaluatorVersions: [] } }) });
  assert.ok(noProvenance.refusals.includes('insufficient-provenance'));

  const noHeldOut = governProposal({ ...base, evaluationReport: { ...report, deltas: null }, proposal: proposal() });
  assert.ok(noHeldOut.refusals.includes('missing-held-out-results'));

  const unknownApprover = governProposal({ ...base, proposal: proposal({ approver: { identity: 'stranger' } }) });
  assert.ok(unknownApprover.refusals.includes('unknown-approver'));

  const unresolvedDep = governProposal({ ...base, proposal: proposal({ dependencies: ['dep-x'] }), resolvedDependencies: [] });
  assert.ok(unresolvedDep.refusals.includes('unresolved-dependency'));
});

test('a deterministic regression refuses even with a tampered promotable flag', () => {
  const blocked = runDeterministicGates(candidate({ toolsUsed: ['read', 'shell'] }), ITEM, BUDGETS);
  const report = buildEvaluationReport({ baseline: candidate(), candidate: candidate(), deterministic: blocked, judges: [{ verdict: 'pass' }] });
  report.decision = { promotable: true, reason: 'tampered' };
  const decision = governProposal({ proposal: proposal(), dataset: ITEM, evaluationReport: report, knownApprovers: KNOWN });
  assert.equal(decision.admissible, false);
  assert.ok(decision.refusals.includes('failed-deterministic-checks') || decision.stage === 'promotion');
});

test('the mutation boundary requires a recorded human approval (AC3)', () => {
  const approved = requireApproval({ proposal: proposal({ state: 'awaiting_approval' }), approval: { identity: 'gd', approvedAt: '2026-06-21T00:00:00Z' }, knownApprovers: KNOWN });
  assert.equal(approved.ok, true);
  assert.equal(approved.proposal.state, 'approved');
  assert.equal(approved.proposal.approver.identity, 'gd');
  assert.equal(approved.proposal.approver.approvedAt, '2026-06-21T00:00:00Z');

  const stranger = requireApproval({ proposal: proposal({ state: 'awaiting_approval' }), approval: { identity: 'stranger' }, knownApprovers: KNOWN });
  assert.equal(stranger.ok, false);

  const wrongState = requireApproval({ proposal: proposal({ state: 'observed' }), approval: { identity: 'gd' }, knownApprovers: KNOWN });
  assert.equal(wrongState.ok, false);
});

test('rollout is planned and apply/rollback are traceable (AC4)', () => {
  const plan = planRollout({ proposal: proposal({ state: 'approved' }) });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.plan.steps, ['sandbox', 'staged-apply', 'post-apply-monitor']);
  assert.equal(plan.plan.rollbackTarget.version, 'v1.0.0');

  const applied = recordApplication({ proposal: proposal({ state: 'approved' }), monitor: 'mon-1', nowIso: '2026-06-21T01:00:00Z' });
  assert.equal(applied.ok, true);
  assert.equal(applied.proposal.state, 'applied');

  const rolledBack = recordRollback({ proposal: applied.proposal, reason: 'regression', nowIso: '2026-06-21T02:00:00Z' });
  assert.equal(rolledBack.ok, true);
  assert.equal(rolledBack.proposal.state, 'rolled_back');
  assert.equal(rolledBack.proposal.rollout.rolledBackTo.version, 'v1.0.0');
});
