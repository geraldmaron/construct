/**
 * tests/functional/specialist-loop.functional.test.mjs — the governed specialist
 * improvement seam (construct-6zga.1.7).
 *
 * Drives the opt-in specialist loop through the real controller and the real 1.6
 * evaluation report, proving the governance invariants end to end:
 *   - the loop runs only when opted in for a bounded trigger (AC3).
 *   - a controlled upstream/provider failure produces no specialist proposal (AC2).
 *   - a genuine specialist fault yields a single scoped proposal routed through the
 *     controller, held to held-out evaluation and human approval, never applied (AC4, AC5).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runDeterministicGates, buildEvaluationReport } from '../../lib/evals/gates.mjs';
import { runSpecialistImprovement } from '../../lib/improvement/specialist-loop.mjs';
import { validateProposal } from '../../lib/improvement/proposal.mjs';

const ITEM = {
  schemaVersion: 1, id: 'eval-1', taskFamily: 'engineering',
  taskInput: { prompt: 'fix the bug' }, capabilitySnapshot: { capabilityClass: 'hosted-direct' },
  allowedTools: ['read', 'search'], expectedEvidenceBehavior: { requirement: 'required', citationsRequired: true },
  expectedContractResult: { outcome: 'pass' }, redaction: { state: 'raw' }, sourceTraceIds: ['trace-eval'],
  humanLabel: { provenance: 'human' }, split: 'test', expiry: null,
};
const BUDGETS = { maxCost: 0.5, maxLatencyMs: 30000 };

function evalReport() {
  const candidate = {
    contractResult: { outcome: 'pass' }, citedSourceIds: ['trace-eval'], evidence: { provided: true },
    toolsUsed: ['read'], permissionViolations: [], cost: 0.2, latencyMs: 9000, output: { ok: true }, outputStructured: true,
  };
  const deterministic = runDeterministicGates(candidate, ITEM, BUDGETS);
  return buildEvaluationReport({ baseline: { ...candidate, cost: 0.4 }, candidate, deterministic, judges: [{ verdict: 'pass' }] });
}

function trace(over = {}) {
  return {
    schemaVersion: 1, id: 'st-1',
    specialist: { role: 'engineer', profileId: 'balanced', capabilityClass: 'hosted-direct' },
    versions: { prompt: 'p1' },
    upstream: over.upstream || { evidenceComplete: true, inputsPresent: true },
    provider: over.provider || { executionError: false, degraded: false },
    specialistOutput: over.specialistOutput || { evidenceVerdict: 'pass' },
    handoff: { inputValid: true, schemaValid: true, output: {} },
    downstream: { consumerError: false, outcome: 'accepted' },
    evaluator: { abstained: false, confidence: 0.9 },
    sourceTraceIds: ['src-1'], humanCorrection: null,
  };
}

const KNOWN = ['gd'];

test('the loop is inert unless opted in for a bounded trigger (AC3)', () => {
  const off = runSpecialistImprovement({ trace: trace({ specialistOutput: { evidenceVerdict: 'fail' } }), trigger: { kind: 'human-correction', optIn: false } });
  assert.equal(off.triggered, false);
});

test('a controlled upstream failure produces no specialist proposal (AC2)', () => {
  const result = runSpecialistImprovement({
    trace: trace({ upstream: { evidenceComplete: false, inputsPresent: true }, specialistOutput: { evidenceVerdict: 'fail' } }),
    trigger: { kind: 'deterministic-failure', optIn: true },
    dataset: ITEM, evaluationReport: evalReport(), knownApprovers: KNOWN,
  });
  assert.equal(result.triggered, true);
  assert.equal(result.proposed, false);
  assert.equal(result.reason, 'upstream-context');
});

test('a controlled provider failure produces no specialist proposal (AC2)', () => {
  const result = runSpecialistImprovement({
    trace: trace({ provider: { executionError: true, degraded: false }, specialistOutput: { evidenceVerdict: 'fail' } }),
    trigger: { kind: 'deterministic-failure', optIn: true },
    dataset: ITEM, evaluationReport: evalReport(), knownApprovers: KNOWN,
  });
  assert.equal(result.proposed, false);
  assert.equal(result.reason, 'provider-execution');
});

test('a genuine specialist fault yields a scoped, governed, approval-gated proposal (AC4, AC5)', () => {
  const result = runSpecialistImprovement({
    trace: trace({ specialistOutput: { evidenceVerdict: 'fail' } }),
    trigger: { kind: 'human-correction', optIn: true },
    target: 'prompt', baselineVersion: 'v1', candidateVersion: 'v2', approver: 'gd',
    dataset: ITEM, evaluationReport: evalReport(), knownApprovers: KNOWN,
  });
  assert.equal(result.triggered, true);
  assert.equal(result.proposed, true);
  assert.equal(result.attribution.cause, 'specialist-prompt');

  assert.ok(validateProposal(result.proposal).valid);
  assert.equal(result.proposal.blastRadius, 'single-surface', 'a proposal targets one specialist artifact');
  assert.notEqual(result.proposal.state, 'applied', 'no automatic application (AC5)');

  assert.equal(result.governance.admissible, true);
  assert.equal(result.governance.stage, 'awaiting-approval', 'still gated on human approval (AC4)');
});
