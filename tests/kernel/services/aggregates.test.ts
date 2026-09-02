/**
 * tests/kernel/services/aggregates.test.ts — staff, routine, inbox, interactive lifecycle.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStateStore } from '../../../src/kernel/state-v1/open.ts';
import { resolveProjectContext } from '../../../src/kernel/project/context.ts';
import {
  createProjectService,
  createStaffService,
  createSourceService,
  createRoutineService,
  createDecisionService,
  createInteractiveRunService,
  createHeadlessRunService,
  createTaskService,
} from '../../../src/kernel/services/index.ts';

function withStore(fn: (store: ReturnType<typeof openStateStore>) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'construct-svc-'));
  const store = openStateStore(join(root, 'db.sqlite'));
  try {
    fn(store);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test('interactive claim/submit leaves draft; staff identity is not an executor', () => {
  withStore((store) => {
    const at = '2026-08-31T18:00:00.000Z';
    const staff = createStaffService(store);
    const member = staff.create({
      id: 'staff-sec',
      name: 'Security owner',
      title: 'Security',
      mission: 'Own auth review routines',
      concerns: ['security'],
      skillIds: ['adversarial-review'],
      at,
    });
    assert.equal(member.status, 'active');

    const interactive = createInteractiveRunService(store, {
      client: 'cursor',
      host: 'cursor-agent',
      owner: 'session:cursor',
    });
    interactive.startRun({
      id: 'run-1',
      outcome: 'review auth redesign',
      at,
      concerns: [{ domain: 'security', why: 'auth change' }],
      tasks: [{ id: 'task-1', role: 'security', brief: { ask: 'gaps' } }],
    });

    const leased = interactive.nextWork({
      now: at,
      leaseUntil: '2026-08-31T19:00:00.000Z',
      runId: 'run-1',
    });
    assert.ok(leased);
    assert.equal(leased.state, 'leased');

    const submitted = interactive.submitWork({
      leased,
      at: '2026-08-31T18:05:00.000Z',
      deliverable: { gaps: ['no MFA on reset'] },
    });
    assert.equal(submitted.task.state, 'done');
    assert.equal(submitted.deliverable?.trustState, 'draft');

    // Same staff, different session executor — staff ≠ executor.
    const other = createInteractiveRunService(store, {
      client: 'opencode',
      host: 'opencode',
      owner: 'session:opencode',
    });
    assert.equal(other.effectiveExecutor().executor, 'opencode');
    assert.equal(staff.get('staff-sec')?.id, 'staff-sec');
  });
});

test('routine requires expected output and pins headless executor', () => {
  withStore((store) => {
    const at = '2026-08-31T18:00:00.000Z';
    const sources = createSourceService(store);
    sources.add({
      id: 'src-1',
      kind: 'repo',
      locator: '.',
      authority: 'primary',
      at,
    });
    const routines = createRoutineService(store);
    assert.throws(
      () =>
        routines.create({
          id: 'r-bad',
          triggerKind: 'manual',
          trigger: {},
          workflow: { skill: 'adversarial-review' },
          expectedOutput: '   ',
          at,
        }),
      /expected output/,
    );

    const routine = routines.create({
      id: 'r-1',
      triggerKind: 'scheduled',
      trigger: { every: '1d' },
      workflow: { skill: 'adversarial-review' },
      inputSourceIds: ['src-1'],
      expectedOutput: 'weekly auth posture note',
      executionPolicy: { mode: 'headless', pin: 'claude' },
      at,
    });
    assert.equal(routine.enabled, true);

    const headless = createHeadlessRunService(store, {
      executorPin: 'claude',
      owner: 'routine:r-1',
      allowResourceSelection: false,
    });
    assert.throws(
      () => headless.selectExecutorIfAllowed(() => 'should-not-run'),
      /resource selection is disabled/,
    );

    const ran = routines.runOnce('r-1', '2026-08-31T18:10:00.000Z');
    assert.equal(ran.executorPin, 'claude');
    assert.ok(ran.run.id.startsWith('run-routine-r-1-'));
    assert.equal(ran.routine.lastRunAt, '2026-08-31T18:10:00.000Z');

    routines.disable('r-1', '2026-08-31T18:11:00.000Z');
    assert.throws(() => routines.runOnce('r-1', '2026-08-31T18:12:00.000Z'), /disabled/);
  });
});

test('inbox raises and resolves typed decisions with side effects', () => {
  withStore((store) => {
    const at = '2026-08-31T18:00:00.000Z';
    const decisions = createDecisionService(store);
    decisions.raise({
      id: 'dec-1',
      kind: 'requires_action_approval',
      question: 'Publish the security note?',
      at,
    });
    assert.equal(decisions.inbox().length, 1);
    const resolved = decisions.resolve({
      id: 'dec-1',
      resolution: { approve: true },
      resolvedBy: 'gerald',
      at: '2026-08-31T18:01:00.000Z',
    });
    assert.equal(resolved.state, 'resolved');
    assert.equal(decisions.inbox().length, 0);

    const interactive = createInteractiveRunService(store, {
      client: 'cursor',
      host: 'cursor',
      owner: 'session:cursor',
    });
    interactive.startRun({
      id: 'run-j',
      outcome: 'judge',
      at,
      tasks: [{ id: 'task-j', role: 'security', brief: {} }],
    });
    const leased = interactive.nextWork({
      now: at,
      leaseUntil: '2026-08-31T19:00:00.000Z',
      runId: 'run-j',
    });
    assert.ok(leased);
    interactive.submitWork({
      leased,
      at: '2026-08-31T18:05:00.000Z',
      deliverable: { body: 'draft' },
    });

    decisions.raise({
      id: 'dec-trust',
      kind: 'requires_trust',
      question: 'Accept?',
      subject: { taskId: 'task-j' },
      at: '2026-08-31T18:06:00.000Z',
    });
    decisions.resolve({
      id: 'dec-trust',
      resolution: { call: 'accept' },
      resolvedBy: 'gerald',
      at: '2026-08-31T18:07:00.000Z',
    });
    assert.equal(
      createTaskService(store).deliverableFor('task-j')?.trustState,
      'accepted',
    );

    const ctx = resolveProjectContext({ cwd: '/tmp/proj', allowCwdFallback: true });
    const status = createProjectService(store, ctx).status();
    assert.equal(status.format, 'construct-state');
    assert.equal(status.openDecisions.length, 0);
  });
});
