/**
 * tests/specialist-loop.test.mjs — unit coverage for opt-in, attribution-first
 * specialist improvement (construct-6zga.1.7).
 *
 * Proves a failure is attributed to the right cause — and never to the specialist
 * when an upstream, provider, contract, downstream, or evaluator cause is present —
 * that triggers are bounded and opt-in, and that a proposal is built only when the
 * specialist itself is at fault.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attributeFailure, shouldTrigger, proposeSpecialistChange, validateSpecialistTrace,
} from '../lib/improvement/specialist-loop.mjs';
import { validateProposal } from '../lib/improvement/proposal.mjs';

function trace(over = {}) {
  return {
    schemaVersion: 1,
    id: over.id || 'st-1',
    specialist: over.specialist || { role: 'engineer', profileId: 'balanced', capabilityClass: 'hosted-direct' },
    versions: over.versions || { taskPacket: 'tp1', prompt: 'p1', skill: 's1', roleFlavor: 'rf1' },
    upstream: over.upstream || { evidenceComplete: true, inputsPresent: true },
    provider: over.provider || { executionError: false, degraded: false },
    specialistOutput: over.specialistOutput || { evidenceVerdict: 'pass' },
    handoff: over.handoff || { inputValid: true, schemaValid: true, output: {} },
    downstream: over.downstream || { consumerError: false, outcome: 'accepted' },
    evaluator: over.evaluator || { abstained: false, confidence: 0.9 },
    cost: 0.1, latencyMs: 8000, toolTimeline: [],
    sourceTraceIds: over.sourceTraceIds || ['src-1'],
    humanCorrection: 'humanCorrection' in over ? over.humanCorrection : null,
  };
}

test('a complete trace validates', () => {
  assert.ok(validateSpecialistTrace(trace()).valid);
});

test('the validator rejects an invalid verdict and a non-boolean signal', () => {
  assert.equal(validateSpecialistTrace(trace({ specialistOutput: { evidenceVerdict: 'maybe' } })).valid, false);
  assert.equal(validateSpecialistTrace(trace({ upstream: { evidenceComplete: 'yes', inputsPresent: true } })).valid, false);
});

test('an upstream or provider failure is never attributed to the specialist (AC2)', () => {
  const upstream = attributeFailure(trace({ upstream: { evidenceComplete: false, inputsPresent: true }, specialistOutput: { evidenceVerdict: 'fail' } }));
  assert.equal(upstream.cause, 'upstream-context');
  assert.equal(upstream.blameSpecialist, false);

  const provider = attributeFailure(trace({ provider: { executionError: true, degraded: false }, specialistOutput: { evidenceVerdict: 'fail' } }));
  assert.equal(provider.cause, 'provider-execution');
  assert.equal(provider.blameSpecialist, false);
});

test('contract, downstream, and evaluator causes preempt specialist blame', () => {
  assert.equal(attributeFailure(trace({ handoff: { inputValid: false, schemaValid: true }, specialistOutput: { evidenceVerdict: 'fail' } })).cause, 'handoff-contract');
  assert.equal(attributeFailure(trace({ downstream: { consumerError: true, outcome: 'rejected' }, specialistOutput: { evidenceVerdict: 'fail' } })).cause, 'downstream-consumer');
  assert.equal(attributeFailure(trace({ evaluator: { abstained: true, confidence: null }, specialistOutput: { evidenceVerdict: 'fail' } })).cause, 'evaluator-uncertainty');
});

test('the specialist is blamed only when every external cause is clean', () => {
  const verdictFail = attributeFailure(trace({ specialistOutput: { evidenceVerdict: 'fail' } }));
  assert.equal(verdictFail.cause, 'specialist-prompt');
  assert.equal(verdictFail.blameSpecialist, true);

  const schemaInvalid = attributeFailure(trace({ handoff: { inputValid: true, schemaValid: false } }));
  assert.equal(schemaInvalid.cause, 'specialist-prompt');
});

test('a human correction naming a non-specialist cause is authoritative', () => {
  const corrected = attributeFailure(trace({ humanCorrection: { target: 'upstream' }, specialistOutput: { evidenceVerdict: 'fail' } }));
  assert.equal(corrected.cause, 'upstream-context');
  assert.equal(corrected.blameSpecialist, false);
});

test('triggers are bounded and opt-in (AC3)', () => {
  assert.equal(shouldTrigger({ kind: 'human-correction', optIn: false }), false, 'off by default');
  assert.equal(shouldTrigger({ kind: 'human-correction', optIn: true }), true);
  assert.equal(shouldTrigger({ kind: 'idle-curiosity', optIn: true }), false, 'unknown trigger rejected');
});

test('a proposal is built only on specialist fault and is schema-valid', () => {
  const none = proposeSpecialistChange({ trace: trace({ upstream: { evidenceComplete: false, inputsPresent: true } }) });
  assert.equal(none.proposed, false);
  assert.equal(none.reason, 'upstream-context');

  const built = proposeSpecialistChange({ trace: trace({ specialistOutput: { evidenceVerdict: 'fail' } }), target: 'prompt', baselineVersion: 'v1', candidateVersion: 'v2', approver: 'gd' });
  assert.equal(built.proposed, true);
  assert.equal(built.proposal.type, 'prompt');
  assert.equal(built.proposal.blastRadius, 'single-surface');
  assert.ok(validateProposal(built.proposal).valid);
});
