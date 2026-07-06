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
  const wf = gaps.find((g) => g.id === 'workflow-misaligned');
  assert.ok(wf);
  assert.equal(autoRaiseEnabledForGap(wf), false);
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

test('synthesizeVerdict detects team-understaffed signal', () => {
  const readModel = {
    parity: { ok: true, skipped: false },
    contractViolations: { recentCount: 0 },
    doctorLog: { recent: [] },
    outcomes: { present: true, roles: {} },
    alignmentCensus: { present: true, generatedAt: new Date().toISOString(), stale: false, audit: { regressions: [] }, skills: {} },
    registryValidate: { needsRun: false, warningCount: 0 },
    observations: { present: true, count: 1 },
    orgGraph: {},
    teamGovernance: {
      present: true,
      teamCount: 2,
      teams: {
        'product-group': { id: 'product-group', name: 'Product Group', roleCount: 5, specialistCount: 1, understaffed: true, escalationPathBroken: false, ownerExists: true },
        'engineering-group': { id: 'engineering-group', name: 'Engineering Group', roleCount: 6, specialistCount: 3, understaffed: false, escalationPathBroken: false, ownerExists: true },
      },
    },
    projectDir: '/tmp',
  };
  const { gaps, recommendedActions } = synthesizeVerdict(readModel);
  const staffGap = gaps.find((g) => g.id === 'team-understaffed');
  assert.ok(staffGap);
  assert.equal(staffGap.severity, 'high');
  assert.ok(staffGap.detail.includes('product-group'));
  const action = recommendedActions.find((a) => a.kind === 'specialist-review' && a.summary.includes('staffing'));
  assert.ok(action);
});

test('synthesizeVerdict detects escalation-path-broken signal', () => {
  const readModel = {
    parity: { ok: true, skipped: false },
    contractViolations: { recentCount: 0 },
    doctorLog: { recent: [] },
    outcomes: { present: true, roles: {} },
    alignmentCensus: { present: true, generatedAt: new Date().toISOString(), stale: false, audit: { regressions: [] }, skills: {} },
    registryValidate: { needsRun: false, warningCount: 0 },
    observations: { present: true, count: 1 },
    orgGraph: {},
    teamGovernance: {
      present: true,
      teamCount: 1,
      teams: {
        'quality-group': { id: 'quality-group', name: 'Quality Group', roleCount: 6, specialistCount: 3, understaffed: false, escalationPathBroken: true, ownerExists: true },
      },
    },
    projectDir: '/tmp',
  };
  const { gaps, recommendedActions } = synthesizeVerdict(readModel);
  const escalGap = gaps.find((g) => g.id === 'escalation-path-broken');
  assert.ok(escalGap);
  assert.equal(escalGap.severity, 'high');
  assert.ok(escalGap.detail.includes('quality-group'));
  const action = recommendedActions.find((a) => a.kind === 'registry-validate');
  assert.ok(action);
});

test('synthesizeVerdict detects team-decision-violation signal', () => {
  const readModel = {
    parity: { ok: true, skipped: false },
    contractViolations: { recentCount: 0 },
    doctorLog: { recent: [] },
    outcomes: { present: true, roles: {} },
    alignmentCensus: { present: true, generatedAt: new Date().toISOString(), stale: false, audit: { regressions: [] }, skills: {} },
    registryValidate: { needsRun: false, warningCount: 0 },
    observations: { present: true, count: 1 },
    orgGraph: {},
    teamGovernance: {
      present: true,
      teamCount: 2,
      teams: {
        'governance-group': { id: 'governance-group', name: 'Governance Group', owner: 'security', roleCount: 2, specialistCount: 0, understaffed: false, escalationPathBroken: false, ownerExists: false },
        'operations-group': { id: 'operations-group', name: 'Operations Group', owner: 'sre', roleCount: 4, specialistCount: 2, understaffed: false, escalationPathBroken: false, ownerExists: true },
      },
    },
    projectDir: '/tmp',
  };
  const { gaps, recommendedActions } = synthesizeVerdict(readModel);
  const violGap = gaps.find((g) => g.id === 'team-decision-violation');
  assert.ok(violGap);
  assert.equal(violGap.severity, 'high');
  assert.ok(violGap.detail.includes('governance-group'));
  assert.ok(violGap.detail.includes('security'));
  const action = recommendedActions.find((a) => a.kind === 'specialist-review' && a.summary.includes('owner'));
  assert.ok(action);
});

test('synthesizeVerdict surfaces cross-team-handoff-blocked when an approver team is unstaffed', () => {
  const readModel = {
    teamGovernance: {
      present: true,
      teams: {},
      crossTeamHandoffsBlocked: [
        { contract: 'engineer-to-reviewer', producerTeam: 'engineering-group', consumerTeam: 'quality-group', blockedBy: ['quality-group'] },
      ],
    },
    projectDir: '/tmp',
  };
  const { gaps, recommendedActions, verdict } = synthesizeVerdict(readModel);
  const blocked = gaps.find((g) => g.id === 'cross-team-handoff-blocked');
  assert.ok(blocked, 'cross-team-handoff-blocked gap should be present');
  assert.equal(blocked.severity, 'high');
  assert.equal(blocked.remediationRoute.primary, 'cx-operations', 'cross-team handoff blocks route to operations (rd-lead retired, construct-rf26.11)');
  assert.ok(blocked.detail.includes('engineer-to-reviewer'));
  assert.equal(verdict, 'degraded');
  assert.ok(recommendedActions.some((a) => a.kind === 'specialist-review' && a.summary.includes('approver team')));
});

test('synthesizeVerdict emits no cross-team-handoff-blocked when no handoffs are blocked', () => {
  const readModel = { teamGovernance: { present: true, teams: {}, crossTeamHandoffsBlocked: [] }, projectDir: '/tmp' };
  const { gaps } = synthesizeVerdict(readModel);
  assert.ok(!gaps.some((g) => g.id === 'cross-team-handoff-blocked'));
});

test('resolveRemediationDispatch uses static mode for single-team gaps', () => {
  const dispatch = resolveRemediationDispatch({
    id: 'outcomes-missing',
    detail: 'No .cx/outcomes/_summary.json — learning tiebreakers are blind',
    remediationRoute: { primary: 'cx-data-engineer' },
  }, { cwd: process.cwd() });
  assert.equal(dispatch.mode, 'static');
  assert.deepEqual(dispatch.specialists, ['cx-data-engineer']);
  assert.ok((dispatch.teamRouting?.involvedTeams ?? []).length <= 1);
});

test('resolveRemediationDispatch uses swarm mode when multiple teams are involved', () => {
  // cx-engineer (engineering-team) and cx-operations (operations-team): a
  // genuinely cross-team pair, needed to exercise real swarm dispatch.
  const dispatch = resolveRemediationDispatch({
    id: 'parity-drift',
    detail: 'Project adapter parity check failed',
    remediationRoute: { primary: 'cx-engineer', secondary: 'cx-operations' },
  }, { cwd: process.cwd() });
  assert.equal(dispatch.mode, 'swarm');
  assert.ok(dispatch.specialists.includes('cx-engineer'));
  assert.ok(dispatch.specialists.includes('cx-operations'));
  assert.ok((dispatch.teamRouting?.involvedTeams ?? []).length > 1);
});

test('synthesizeVerdict attaches swarm dispatch metadata to cross-team gaps', () => {
  const readModel = {
    teamGovernance: {
      present: true,
      teams: {},
      crossTeamHandoffsBlocked: [
        { contract: 'engineer-to-reviewer', producerTeam: 'engineering-group', consumerTeam: 'quality-group', blockedBy: ['quality-group'] },
      ],
    },
    projectDir: process.cwd(),
  };
  const { gaps } = synthesizeVerdict(readModel);
  const blocked = gaps.find((g) => g.id === 'cross-team-handoff-blocked');
  assert.ok(blocked?.remediationRoute?.mode);
  assert.ok(Array.isArray(blocked?.remediationRoute?.specialists));
  assert.ok(Array.isArray(blocked?.remediationRoute?.teamRouting?.involvedTeams));
});
