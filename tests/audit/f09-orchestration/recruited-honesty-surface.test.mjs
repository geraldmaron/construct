/**
 * tests/audit/f09-orchestration/recruited-honesty-surface.test.mjs —
 * recruited-but-unexecuted reviewers are loud on the shaped surface
 * (construct-pteo2.12).
 *
 * shapeRun is a pure function over a run record, so the mixed silent-no-op
 * case — Assignment tasks executed, a recruited Worker Profile only prepared, run
 * persisted 'completed' before finalizeRun's degrade flip existed — is pinned
 * synthetically: the shaped surface must carry recruitmentHonesty and a
 * RECRUITED-NOT-EXECUTED message, and a prepare-only run keeps its own louder
 * notice while still listing the recruits.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { shapeRun } from '../../../lib/mcp/tools/orchestration-run.mjs';

function baseRun(overrides = {}) {
  return {
    runId: 'run-recruit-honesty',
    status: 'completed',
    plan: {
      intent: 'build',
      track: 'focused',
      assignments: [
        { id: 'assignment-1', workerProfileId: 'engineer', recruited: false },
        { id: 'assignment-2', workerProfileId: 'operations', recruited: true },
      ],
    },
    tasks: [],
    ...overrides,
  };
}

test('a mixed run with an unexecuted recruit surfaces RECRUITED-NOT-EXECUTED, never a bare completed read', () => {
  const shaped = shapeRun(baseRun({
    tasks: [
      { id: 't1', workerProfileId: 'engineer', status: 'done', executor: 'provider:anthropic:m', executionState: 'executed', recruited: false },
      { id: 't2', workerProfileId: 'operations', status: 'prepared', executor: 'inline:prepared', executionState: 'prepared', recruited: true },
    ],
    recruitmentHonesty: {
      unexecutedRecruits: [{ workerProfileId: 'operations', executionState: 'prepared', reason: 'wide blast radius' }],
      note: 'recruited reviewer(s) were prepared but never executed — their review was NOT performed',
    },
  }));

  assert.ok(shaped.recruitmentHonesty, 'shaped surface carries the honesty block');
  assert.match(shaped.message, /RECRUITED-NOT-EXECUTED: operations/);
  assert.match(shaped.message, /NOT performed/);
  assert.equal(shaped.tasks.find((t) => t.id === 't2').recruited, true, 'per-task recruited flag shaped through');
});

test('a prepare-only run keeps its own notice and still lists the recruits', () => {
  const shaped = shapeRun(baseRun({
    tasks: [
      { id: 't1', workerProfileId: 'engineer', status: 'prepared', executionState: 'prepared', recruited: false },
      { id: 't2', workerProfileId: 'operations', status: 'prepared', executionState: 'prepared', recruited: true },
    ],
    recruitmentHonesty: {
      unexecutedRecruits: [{ workerProfileId: 'operations', executionState: 'prepared', reason: 'wide blast radius' }],
      note: 'recruited reviewer(s) were prepared but never executed — their review was NOT performed',
    },
  }));

  assert.equal(shaped.status, 'completed-prepare-only');
  assert.match(shaped.message, /PREPARE-ONLY/, 'prepare-only notice stays the primary message');
  assert.ok(shaped.recruitmentHonesty, 'recruits still listed alongside');
});

test('a run whose recruits executed shapes with no honesty block and no message', () => {
  const shaped = shapeRun(baseRun({
    tasks: [
      { id: 't1', workerProfileId: 'engineer', status: 'done', executionState: 'executed', recruited: false },
      { id: 't2', workerProfileId: 'operations', status: 'done', executionState: 'executed', recruited: true },
    ],
  }));
  assert.equal(shaped.recruitmentHonesty ?? null, null);
  assert.equal(shaped.message ?? null, null);
  assert.equal(shaped.status, 'completed');
});
