/**
 * tests/functional/oracle-synthesis.functional.test.mjs —
 *
 * Synthesis edge cases: doctor kind escalate, census regressions, conditional
 * registry-validate, org graph gaps.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { synthesizeVerdict, isDoctorEscalation } from '../../lib/oracle/synthesize.mjs';
import { autoRaiseEnabledForGap } from '../../lib/oracle/policy.mjs';
import { resolveRemediationDispatch } from '../../lib/oracle/remediation-dispatch.mjs';
import { buildRoutingArtifact } from '../../lib/oracle/dispatch.mjs';

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
    outcomes: { present: true, workerProfiles: {} },
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
    outcomes: { present: true, workerProfiles: {} },
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
    outcomes: { present: true, workerProfiles: {} },
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
    outcomes: { present: true, workerProfiles: {} },
    alignmentCensus: { present: true, generatedAt: new Date().toISOString(), stale: false, audit: { regressions: [] }, skills: {} },
    registryValidate: { needsRun: false, warningCount: 0 },
    observations: { present: true, count: 1 },
    orgGraph: {
      workflow: { present: false, findings: [{ severity: 'HIGH', issue: 'No .construct/workflow.json found' }] },
      propagation: { needsPropagation: false },
    },
    projectDir: '/tmp',
  };
  const { gaps } = synthesizeVerdict(readModel);
  const wf = gaps.find((g) => g.id === 'workflow-misaligned');
  assert.ok(wf);
  assert.equal(autoRaiseEnabledForGap(wf), false);
});

test('synthesizeVerdict attaches remediationRoute to gaps and actions', () => {
  const readModel = {
    parity: { ok: false, skipped: false, summary: ['adapter drift'] },
    contractViolations: { recentCount: 0 },
    doctorLog: { recent: [] },
    outcomes: { present: true, workerProfiles: {} },
    alignmentCensus: { present: false },
    registryValidate: { needsRun: false, warningCount: 0 },
    observations: { present: true, count: 1 },
    orgGraph: {},
    projectDir: '/tmp',
  };
  const { gaps, recommendedActions } = synthesizeVerdict(readModel);
  const parityGap = gaps.find((g) => g.id === 'parity-drift');
  assert.equal(parityGap?.remediationRoute?.workerProfileId, 'engineer');
  assert.equal(parityGap?.remediationRoute?.fallbackWorkerProfileId, 'operations');
  assert.equal(parityGap?.remediationRoute?.policyId, 'agents-routing');
  assert.deepEqual(
    parityGap?.remediationRoute?.assignments.map((assignment) => assignment.workerProfileId),
    ['engineer', 'operations'],
  );
  for (const retired of ['primary', 'secondary', 'specialists', 'teamRouting', 'gateType']) {
    assert.equal(retired in parityGap.remediationRoute, false);
  }
  const sync = recommendedActions.find((a) => a.kind === 'adapters-sync');
  assert.equal(sync?.remediationRoute?.workerProfileId, 'orchestrator');
  assert.equal(sync?.remediationRoute?.policyId, 'action-approval');
});

test('routing artifacts render Worker Profiles, Assignments, and Policies only', () => {
  const content = buildRoutingArtifact({
    tickId: 'tick-1',
    synthesis: {
      verdict: 'degraded',
      gaps: [{ id: 'parity-drift', severity: 'high', detail: 'adapter drift' }],
      recommendedActions: [{ kind: 'worker-profile-review', summary: 'review drift' }],
    },
    readModel: null,
    route: {
      workerProfileId: 'engineer',
      policyId: 'agents-routing',
      mode: 'parallel',
      assignments: [
        { id: 'assignment-1', workerProfileId: 'engineer', primary: true },
        { id: 'assignment-2', workerProfileId: 'operations', primary: false },
      ],
    },
  });
  assert.match(content, /WORKER PROFILE: engineer/);
  assert.match(content, /POLICY: agents-routing/);
  assert.match(content, /ASSIGNMENTS: assignment-1=engineer, assignment-2=operations/);
  assert.doesNotMatch(content, /SWARM SPECIALISTS|INVOLVED TEAMS|DISPATCH TARGET/);
});

test('synthesizeVerdict detects unresolved Policy Worker Profile references', () => {
  const readModel = {
    policyGovernance: {
      present: true,
      unresolvedReferences: [{ policy: 'release-gates', workerProfile: 'missing-reviewer' }],
    },
    projectDir: '/tmp',
  };
  const { gaps, recommendedActions } = synthesizeVerdict(readModel);
  const policyGap = gaps.find((g) => g.id === 'policy-worker-profile-unresolved');
  assert.ok(policyGap);
  assert.equal(policyGap.severity, 'high');
  const action = recommendedActions.find((a) => a.kind === 'registry-validate');
  assert.deepEqual(action.references, [{ policy: 'release-gates', workerProfile: 'missing-reviewer' }]);
});

test('synthesizeVerdict emits no Policy gap when every reference resolves', () => {
  const readModel = { policyGovernance: { present: true, unresolvedReferences: [] }, projectDir: '/tmp' };
  const { gaps } = synthesizeVerdict(readModel);
  assert.ok(!gaps.some((g) => g.id === 'policy-worker-profile-unresolved'));
});

test('resolveRemediationDispatch creates one Assignment for one Worker Profile', () => {
  const dispatch = resolveRemediationDispatch({
    id: 'outcomes-missing',
    detail: 'No .construct/outcomes/_summary.json — learning tiebreakers are blind',
    remediationRoute: { workerProfileId: 'data-engineer', fallbackWorkerProfileId: null, policyId: 'agents-routing' },
  }, { cwd: process.cwd() });
  assert.equal(dispatch.mode, 'single');
  assert.deepEqual(dispatch.assignments, [
    { id: 'assignment-1', workerProfileId: 'data-engineer', primary: true },
  ]);
});

test('resolveRemediationDispatch creates parallel Assignments for two Worker Profiles', () => {
  const dispatch = resolveRemediationDispatch({
    id: 'parity-drift',
    detail: 'Project adapter parity check failed',
    remediationRoute: { workerProfileId: 'engineer', fallbackWorkerProfileId: 'operations', policyId: 'agents-routing' },
  }, { cwd: process.cwd() });
  assert.equal(dispatch.mode, 'parallel');
  assert.deepEqual(dispatch.assignments.map((assignment) => assignment.workerProfileId), ['engineer', 'operations']);
});

test('synthesizeVerdict attaches parallel Assignment metadata to multi-profile routes', () => {
  const readModel = {
    parity: { ok: false, skipped: false, summary: ['adapter drift'] },
    projectDir: process.cwd(),
  };
  const { gaps } = synthesizeVerdict(readModel);
  const parity = gaps.find((g) => g.id === 'parity-drift');
  assert.equal(parity?.remediationRoute?.mode, 'parallel');
  assert.deepEqual(parity?.remediationRoute?.assignments.map((assignment) => assignment.workerProfileId), ['engineer', 'operations']);
});
