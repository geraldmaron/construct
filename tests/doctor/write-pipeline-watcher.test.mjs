/**
 * tests/doctor/write-pipeline-watcher.test.mjs — governed-write pipeline watcher.
 *
 * Constructs real ApprovalQueue/WriteSentLog instances persisted under an
 * isolated CONSTRUCT_DOCTOR_ROOT + project root, then asserts the watcher
 * surfaces a stale awaiting_approval record and a sent-log error exactly
 * once each, and stays silent for healthy state.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { tempDir } from '../helpers.mjs';

let watcher;
let audit;
let ApprovalQueue;
let WriteSentLog;
let projectRoot;
let prevDoctorRoot;
let prevProjectRoot;

const createdDirs = [];
test.after(() => {
  for (const dir of createdDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  if (prevDoctorRoot === undefined) delete process.env.CONSTRUCT_DOCTOR_ROOT;
  else process.env.CONSTRUCT_DOCTOR_ROOT = prevDoctorRoot;
  if (prevProjectRoot === undefined) delete process.env.CONSTRUCT_PROJECT_ROOT;
  else process.env.CONSTRUCT_PROJECT_ROOT = prevProjectRoot;
});

test.before(async () => {
  prevDoctorRoot = process.env.CONSTRUCT_DOCTOR_ROOT;
  prevProjectRoot = process.env.CONSTRUCT_PROJECT_ROOT;
  audit = await import('../../lib/doctor/audit.mjs');
  watcher = await import('../../lib/doctor/watchers/write-pipeline.mjs');
  ({ ApprovalQueue } = await import('../../lib/embed/approval-queue.mjs'));
  ({ WriteSentLog } = await import('../../lib/writes/sent-log.mjs'));
});

// Each test gets its own doctor root AND project root: ApprovalQueue.resolvePersistPath
// is doctorRoot-scoped in solo mode (it ignores its rootDir argument entirely),
// while WriteSentLog.resolvePersistPath is project-root-scoped — both must
// rotate per test or persisted state from one test leaks into the next tick().
test.beforeEach(() => {
  const doctorRoot = tempDir('construct-doctor-write-pipeline-');
  projectRoot = tempDir('construct-write-pipeline-project-');
  createdDirs.push(doctorRoot, projectRoot);
  process.env.CONSTRUCT_DOCTOR_ROOT = doctorRoot;
  process.env.CONSTRUCT_PROJECT_ROOT = projectRoot;
  watcher.__resetWritePipelineWatcherState();
});

test('a healthy queue with no stale approvals and no sent-log errors stays silent', async () => {
  const queue = new ApprovalQueue({ persistPath: ApprovalQueue.resolvePersistPath(projectRoot) });
  queue.enqueue({ tool: 'externalPost', args: { channel: '#general' } });

  const result = await watcher.tick();
  assert.equal(result.escalations.length, 0);
});

test('an awaiting_approval record past its expiry escalates exactly once', async () => {
  const queue = new ApprovalQueue({
    persistPath: ApprovalQueue.resolvePersistPath(projectRoot),
    timeoutMs: -1,
  });
  const record = queue.enqueue({ tool: 'jira.issue', args: { summary: 'gap' } });
  assert.ok(new Date(record.expiresAt).getTime() < Date.now(), 'fixture record must already be past expiry');

  const first = await watcher.tick();
  assert.equal(first.escalations.length, 1);
  assert.equal(first.escalations[0].eventType, 'write.approval_stale');
  assert.equal(first.escalations[0].approvalId, record.approvalId);

  const second = await watcher.tick();
  assert.equal(second.escalations.length, 0, 'the same stale record must not re-escalate on the next tick');

  const recorded = audit.recent({ watcher: 'write-pipeline', kind: 'sample' });
  assert.ok(recorded.some((r) => r.target === record.approvalId && r.result === 'stale'));
});

test('a sent-log entry with status error escalates exactly once', async () => {
  const sentLog = new WriteSentLog({ persistPath: WriteSentLog.resolvePersistPath(projectRoot) });
  sentLog.record({
    idempotencyKey: 'test-key-1',
    writeType: 'issue',
    provider: 'jira',
    status: 'error',
    error: 'HTTP 500',
  });

  const first = await watcher.tick();
  assert.equal(first.escalations.filter((e) => e.eventType === 'write.send_failed').length, 1);

  const second = await watcher.tick();
  assert.equal(second.escalations.filter((e) => e.eventType === 'write.send_failed').length, 0);
});
