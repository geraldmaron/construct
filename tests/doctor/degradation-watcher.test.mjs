/**
 * tests/doctor/degradation-watcher.test.mjs — daemon capability-decline watcher.
 *
 * Writes real entries via lib/embed/degradation.mjs under an isolated
 * project root, then asserts the watcher surfaces each exactly once and
 * stays silent for a healthy (empty) ledger.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { tempDir } from '../helpers.mjs';

let watcher;
let audit;
let recordDegradation;
let projectRoot;

test.before(async () => {
  audit = await import('../../lib/doctor/audit.mjs');
  watcher = await import('../../lib/doctor/watchers/degradation.mjs');
  ({ recordDegradation } = await import('../../lib/embed/degradation.mjs'));
});

test.beforeEach(() => {
  projectRoot = tempDir('construct-degradation-project-');
  process.env.CONSTRUCT_PROJECT_ROOT = projectRoot;
  watcher.__resetDegradationWatcherState();
});

test('an empty degradation ledger stays silent', async () => {
  const result = await watcher.tick();
  assert.equal(result.escalations.length, 0);
});

test('a recorded degradation escalates exactly once', async () => {
  recordDegradation(projectRoot, { job: 'directive-runner', reason: 'unknown-specialist', detail: 'cx-nonexistent' });

  const first = await watcher.tick();
  assert.equal(first.escalations.length, 1);
  assert.equal(first.escalations[0].eventType, 'daemon.capability_declined');

  const second = await watcher.tick();
  assert.equal(second.escalations.length, 0, 'the same entry must not re-escalate on the next tick');

  const recorded = audit.recent({ watcher: 'degradation', kind: 'sample' });
  assert.ok(recorded.some((r) => r.result === 'degraded' && r.context?.reason === 'unknown-specialist'));
});

test('multiple distinct entries each escalate exactly once', async () => {
  recordDegradation(projectRoot, { job: 'directive-runner', reason: 'unknown-specialist', detail: 'a' });
  recordDegradation(projectRoot, { job: 'directive-runner', reason: 'unknown-provider', detail: 'b' });

  const result = await watcher.tick();
  assert.equal(result.escalations.length, 2);
});
