/**
 * tests/functional/oracle-synthesis.functional.test.mjs —
 *
 * Synthesis edge cases: doctor kind escalate, census regressions, conditional
 * registry-validate, org graph gaps.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { synthesizeVerdict, isDoctorEscalation } from '../../lib/oracle/synthesize.mjs';

test('isDoctorEscalation matches production doctor-log shapes', () => {
  assert.equal(isDoctorEscalation({ kind: 'escalation', result: 'escalated' }), true);
  assert.equal(isDoctorEscalation({ kind: 'escalate', result: 'recorded' }), true);
  assert.equal(isDoctorEscalation({ kind: 'action', result: 'recorded' }), false);
});

test('synthesizeVerdict parses census regressions and true orphans', () => {
  const readModel = {
    parity: { ok: true, skipped: false },
    contractViolations: { recentCount: 0 },
    doctorLog: { recent: [] },
    outcomes: { present: true, roles: {} },
    alignmentCensus: {
      present: true,
      generatedAt: new Date().toISOString(),
      stale: false,
      audit: { findingsCount: 2, regressions: ['audit:dead-module:lib/foo.mjs'] },
      skills: { trueOrphanCount: 3 },
    },
    registryValidate: { needsRun: false, warningCount: 0 },
    observations: { present: true, count: 1 },
    orgGraph: {},
    projectDir: '/tmp',
  };
  const { gaps } = synthesizeVerdict(readModel);
  assert.ok(gaps.some((g) => g.id === 'alignment-regression'));
  assert.ok(gaps.some((g) => g.id === 'true-skill-orphan'));
});

test('synthesizeVerdict skips registry-validate when registry is clean', () => {
  const readModel = {
    parity: { ok: true, skipped: false },
    contractViolations: { recentCount: 0 },
    doctorLog: { recent: [] },
    outcomes: { present: true, roles: {} },
    alignmentCensus: { present: true, generatedAt: new Date().toISOString(), stale: false, audit: { regressions: [] }, skills: {} },
    registryValidate: { needsRun: false, valid: true, warningCount: 0, errorCount: 0 },
    observations: { present: true, count: 1 },
    orgGraph: {},
    projectDir: '/tmp',
  };
  const { recommendedActions } = synthesizeVerdict(readModel);
  assert.equal(recommendedActions.some((a) => a.kind === 'registry-validate'), false);
});

test('synthesizeVerdict recommends registry-validate when validation fails', () => {
  const readModel = {
    parity: { ok: true, skipped: false },
    contractViolations: { recentCount: 0 },
    doctorLog: { recent: [] },
    outcomes: { present: true, roles: {} },
    alignmentCensus: { present: true, generatedAt: new Date().toISOString(), stale: false, audit: { regressions: [] }, skills: {} },
    registryValidate: { needsRun: true, valid: false, warningCount: 1, errorCount: 0 },
    observations: { present: true, count: 1 },
    orgGraph: {},
    projectDir: '/tmp',
  };
  const { recommendedActions, gaps } = synthesizeVerdict(readModel);
  assert.ok(recommendedActions.some((a) => a.kind === 'registry-validate'));
  assert.ok(gaps.some((g) => g.id === 'registry-warn'));
});

test('synthesizeVerdict surfaces org graph workflow misalignment', () => {
  const readModel = {
    parity: { ok: true, skipped: false },
    contractViolations: { recentCount: 0 },
    doctorLog: { recent: [] },
    outcomes: { present: true, roles: {} },
    alignmentCensus: { present: true, generatedAt: new Date().toISOString(), stale: false, audit: { regressions: [] }, skills: {} },
    registryValidate: { needsRun: false, warningCount: 0 },
    observations: { present: true, count: 1 },
    orgGraph: {
      workflow: { present: false, findings: [{ severity: 'HIGH', issue: 'No .cx/workflow.json found' }] },
      propagation: { needsPropagation: false },
    },
    projectDir: '/tmp',
  };
  const { gaps } = synthesizeVerdict(readModel);
  assert.ok(gaps.some((g) => g.id === 'workflow-misaligned'));
});

test('synthesizeVerdict attaches remediationRoute to gaps and actions', () => {
  const readModel = {
    parity: { ok: false, skipped: false, summary: ['adapter drift'] },
    contractViolations: { recentCount: 0 },
    doctorLog: { recent: [] },
    outcomes: { present: true, roles: {} },
    alignmentCensus: { present: false },
    registryValidate: { needsRun: false, warningCount: 0 },
    observations: { present: true, count: 1 },
    orgGraph: {},
    projectDir: '/tmp',
  };
  const { gaps, recommendedActions } = synthesizeVerdict(readModel);
  const parityGap = gaps.find((g) => g.id === 'parity-drift');
  assert.ok(parityGap?.remediationRoute?.primary?.startsWith('cx-'));
  const sync = recommendedActions.find((a) => a.kind === 'adapters-sync');
  assert.ok(sync?.remediationRoute?.primary);
});
