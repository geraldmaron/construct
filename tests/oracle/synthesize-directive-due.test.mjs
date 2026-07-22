/**
 * tests/oracle/synthesize-directive-due.test.mjs — construct-p4cba.6 (WS-B5)
 * synthesizeVerdict's directive-due gap + recommendedAction generation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { synthesizeVerdict } from '../../lib/oracle/synthesize.mjs';
import { classifyAction } from '../../lib/oracle/policy.mjs';
import { routeAction, routeGap } from '../../lib/oracle/routing.mjs';

function minimalReadModel(overrides = {}) {
  return {
    parity: { ok: true, skipped: false },
    contractViolations: { recentCount: 0 },
    doctorLog: { recent: [] },
    outcomes: { present: true, workerProfiles: {} },
    // present:true so collectionSignals does not inject not-run and mask the
    // directive-due gap rollup under Construct 2.0 verdict vocabulary.
    alignmentCensus: { present: true },
    registryValidate: { needsRun: false, warningCount: 0 },
    observations: { present: true, count: 1 },
    orgGraph: {},
    projectDir: '/tmp',
    directives: { present: false, due: [] },
    ...overrides,
  };
}

test('no directive gap/action when nothing is due', () => {
  const { gaps, recommendedActions } = synthesizeVerdict(minimalReadModel());
  assert.equal(gaps.some((g) => g.id === 'directive-due'), false);
  assert.equal(recommendedActions.some((a) => a.kind === 'directive-due'), false);
});

test('a due directive produces both a gap and a recommendedAction carrying its Worker Profile', () => {
  const readModel = minimalReadModel({
    directives: {
      present: true,
      due: [{ id: 'jira-weekly-summary', workerProfileId: 'operations', action: 'summarize', instruction: 'Summarize the open Jira work', output: { kind: 'beads' } }],
    },
  });

  const { gaps, recommendedActions, verdict } = synthesizeVerdict(readModel);

  const gapEntry = gaps.find((g) => g.id === 'directive-due');
  assert.ok(gapEntry, 'expected a directive-due gap');
  assert.equal(gapEntry.severity, 'low');
  assert.equal(gapEntry.detail, "Directive due: jira-weekly-summary (summarize via operations)");
  assert.equal(gapEntry.directiveId, 'jira-weekly-summary');

  const actionEntry = recommendedActions.find((a) => a.kind === 'directive-due');
  assert.ok(actionEntry, 'expected a directive-due recommendedAction');
  assert.equal(actionEntry.directiveId, 'jira-weekly-summary');
  assert.equal(actionEntry.directiveWorkerProfileId, 'operations');
  assert.equal(actionEntry.directiveInstruction, 'Summarize the open Jira work');
  assert.deepEqual(actionEntry.directiveOutput, { kind: 'beads' });
  assert.ok(actionEntry.remediationRoute, 'the generic enrichment loop still ran over this action');

  assert.equal(verdict, 'degraded', 'Construct 2.0 rollup: any non-high gap set is degraded (attention retired)');
});

test('multiple due directives each produce their own gap and action', () => {
  const readModel = minimalReadModel({
    directives: {
      present: true,
      due: [
        { id: 'a', workerProfileId: 'operations', action: 'summarize', instruction: 'summarize a' },
        { id: 'b', workerProfileId: 'product-manager', action: 'draft-artifact', instruction: 'draft b' },
      ],
    },
  });

  const { gaps, recommendedActions } = synthesizeVerdict(readModel);
  assert.equal(gaps.filter((g) => g.id === 'directive-due').length, 2);
  assert.equal(recommendedActions.filter((a) => a.kind === 'directive-due').length, 2);
  assert.deepEqual(recommendedActions.filter((a) => a.kind === 'directive-due').map((a) => a.directiveId), ['a', 'b']);
});

test('classifyAction requires human approval for a due directive', () => {
  assert.equal(classifyAction('directive-due'), 'approve');
});

test('routing has a directive-due entry for both gaps and actions', () => {
  assert.equal(routeAction('directive-due').workerProfileId, 'orchestrator');
  assert.equal(routeAction('directive-due').policyId, 'action-approval');
  assert.equal(routeGap({ id: 'directive-due' }).workerProfileId, 'orchestrator');
  assert.equal(routeGap({ id: 'directive-due' }).policyId, 'agents-routing');
});
