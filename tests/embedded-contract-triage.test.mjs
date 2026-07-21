/**
 * tests/embedded-contract-triage.test.mjs — unit tests for embedded triage/planning.
 *
 * Pins the enrichment shape (owner, role chain + rationale, skills, evidence
 * requirements drawn from contracts, expected outputs, approval requirements,
 * risks, next steps, canExecute), the classification-vs-generation confidence
 * distinction, availableRoles filtering, deployment-mode approval, and
 * determinism. The classifier is deterministic so no fixtures are mocked.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { recommendPlan } from '../lib/embedded-contract/triage.mjs';

const BUG = 'Bug report: throws an error with a stack trace, failing test in production';

test('classifies a bug and returns an executable role-aware plan', () => {
  const r = recommendPlan({ input: BUG }, { env: {} });
  assert.equal(r.classification.intakeType, 'bug');
  assert.equal(r.primaryOwner, 'debugger');
  assert.ok(r.recommendedChain.includes('debugger'));
  assert.equal(r.canExecute, true);
  assert.ok(r.roleRationale.length === r.recommendedChain.length);
  assert.equal(r.roleRationale[0].workerProfileId, 'debugger');
  assert.ok(r.suggestedSkills.length > 0);
});

test('evidence requirements surface a warning when the primary owner has no incoming contract', () => {
  const r = recommendPlan({ input: BUG }, { env: {} });
  assert.deepEqual(r.evidenceRequirements, []);
  assert.deepEqual(r.expectedOutputs, []);
  assert.ok(r.warnings.some((w) => w.includes('No declared evidence contract')));
});

test('classification confidence is labeled and distinct from generation confidence', () => {
  const r = recommendPlan({ input: BUG }, { env: {} });
  assert.equal(r.confidenceKind, 'classification');
  assert.equal(typeof r.classificationConfidence, 'number');
  assert.equal('generationConfidence' in r, false);
  assert.equal('confidence' in r, false);
});

test('unknown input is not executable and offers a clarify next step', () => {
  const r = recommendPlan({ input: 'zzzz qqqq' }, { env: {} });
  assert.equal(r.classification.intakeType, 'unknown');
  assert.equal(r.canExecute, false);
  assert.ok(r.nextStepOptions.some((o) => o.action === 'clarify'));
  assert.ok(r.risks.factors.length > 0);
});

test('availableRoles filters the chain and warns about dropped roles', () => {
  const r = recommendPlan({ input: BUG, availableRoles: ['debugger', 'engineer'] }, { env: {} });
  assert.deepEqual(r.recommendedChain, ['debugger', 'engineer']);
  assert.ok(r.warnings.some((w) => w.includes('dropped')));
});

test('availableRoles without the primary owner blocks execution', () => {
  const r = recommendPlan({ input: BUG, availableRoles: ['engineer'] }, { env: {} });
  assert.equal(r.canExecute, false);
  assert.ok(r.warnings.some((w) => w.includes('Primary owner')));
});

test('enterprise deployment mode mandates approval', () => {
  const solo = recommendPlan({ input: BUG }, { env: {} });
  assert.equal(solo.approvalRequirements.requiresApproval, false);
  const ent = recommendPlan({ input: BUG }, { env: { CONSTRUCT_DEPLOYMENT_MODE: 'enterprise' } });
  assert.equal(ent.approvalRequirements.requiresApproval, true);
  assert.match(ent.approvalRequirements.reason, /[Ee]nterprise/);
});

test('recommendPlan is deterministic for the same input', () => {
  const a = recommendPlan({ input: BUG }, { env: {} });
  const b = recommendPlan({ input: BUG }, { env: {} });
  assert.deepEqual(a, b);
});

test('plan carries suggestedProcedureId bridging triage to Procedure invocation', () => {
  const r = recommendPlan({ input: BUG }, { env: {} });
  assert.equal('suggestedProcedureId' in r, true);
});

test('execution preview is gated on host context and a mapped Procedure', () => {
  const env = { CONSTRUCT_MODEL_REASONING: 'anthropic/claude-sonnet-4-6', CONSTRUCT_MODEL_STANDARD: 'anthropic/claude-sonnet-4-6', CONSTRUCT_MODEL_FAST: 'anthropic/claude-sonnet-4-6' };
  assert.equal(recommendPlan({ input: BUG }, { env }).execution, null);
  const unknown = recommendPlan({ input: 'zzzz qqqq', constructStrategy: 'orchestrated', hostModel: 'anthropic/claude-sonnet-4-6' }, { env });
  assert.equal(unknown.suggestedProcedureId, null);
  assert.equal(unknown.execution, null);
});
