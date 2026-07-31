/**
 * tests/functional/build-audit-record.functional.test.mjs — construct-ifwhw.1.
 *
 * Exercises the real modules (no mocks) in an isolated tmpdir: constructs a
 * run via lib/orchestration/run-store.mjs, emits a trace event and a contract
 * violation tagged with that run's runId via lib/worker/trace.mjs and
 * lib/orchestration/worker.mjs's validateInputPacket, then asserts
 * lib/orchestration/build-audit-record.mjs's buildAuditRecord joins all
 * three into one object, and that materializeAuditRecord's write survives a
 * fresh process-equivalent read (loadAuditRecord importing independently).
 *
 * HOME is pinned to the tmpdir so the machine-scoped state root
 * resolves inside it, per the functional-test isolation contract.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { rmTmpDir } from '../helpers/cleanup.mjs';

const tmpDirs = [];
function gitEnvFor(home) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
  };
}

function initGitRepo(cwd) {
  const template = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-git-template-'));
  tmpDirs.push(template);
  try {
    execFileSync('git', ['init', '--quiet', '--initial-branch=main', `--template=${template}`], {
      cwd,
      env: gitEnvFor(cwd),
    });
    return true;
  } catch (err) {
    const blocked = process.env.CURSOR_SANDBOX
      || err.code === 'EPERM'
      || /operation not permitted/i.test(String(err.stderr || err.message || ''));
    return blocked ? false : (() => { throw err; })();
  }
}

function freshProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-audit-record-'));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { rmTmpDir(dir); } catch {}
  }
});

test('buildAuditRecord joins run-store tasks, trace events, and violation-log entries by runId', async (t) => {
  const cwd = freshProject();
  if (!initGitRepo(cwd)) {
    return t.skip('git init blocked (sandbox EPERM)');
  }
  const priorHome = process.env.HOME;
  process.env.HOME = cwd;
  try {
    const { saveRun } = await import('../../lib/orchestration/run-store.mjs');
    const { emitTraceEvent, newTraceId, newSpanId } = await import('../../lib/worker/trace.mjs');
    const { validateInputPacket } = await import('../../lib/orchestration/worker.mjs');
    const { buildAuditRecord, materializeAuditRecord, loadAuditRecord } = await import('../../lib/orchestration/build-audit-record.mjs');

    const runId = 'run-audit-fixture-1';
    const traceId = newTraceId();
    const task = {
      id: 'task-1',
      workerProfileId: 'architect',
      status: 'completed',
      executor: 'provider',
      // product-manager-to-architect requires the canonical PRD handoff fields on input.
      // The packet below omits those fields so validateInputPacket logs a real
      // CONTRACT_VIOLATION tagged with the run's runId, which the record
      // under test must surface.
      inputContractId: 'product-manager-to-architect',
      packet: { problem: 'incomplete handoff on purpose' },
    };
    saveRun(cwd, { runId, status: 'completed', createdAt: new Date(0).toISOString(), tasks: [task] });

    emitTraceEvent({
      rootDir: cwd,
      eventType: 'worker.started',
      traceId,
      spanId: newSpanId(),
      role: task.workerProfileId,
      taskId: task.id,
      metadata: { runId },
    });

    validateInputPacket(task, { cwd, runId, enforcement: 'warn' });

    const record = buildAuditRecord(cwd, runId);
    assert.ok(record, 'buildAuditRecord must return a record for a run that exists');
    assert.equal(record.runId, runId);
    assert.equal(record.taskChain.length, 1);
    assert.equal(record.taskChain[0].id, 'task-1');
    assert.ok(
      record.traceEvents.some((e) => e.eventType === 'worker.started' && e.taskId === 'task-1'),
      'trace event must be joined by runId',
    );
    assert.ok(record.gateVerdicts.length >= 1, 'the contract violation tagged with this runId must appear as a gate verdict');
    assert.equal(record.gateVerdicts[0].direction, 'input');

    const missingRecord = buildAuditRecord(cwd, 'run-does-not-exist');
    assert.equal(missingRecord, null, 'a runId with no run must return null, not a fabricated empty record');

    const materialized = materializeAuditRecord(cwd, runId);
    assert.equal(materialized.runId, runId);
    const readBack = loadAuditRecord(cwd, runId);
    assert.deepEqual(readBack.taskChain, materialized.taskChain, 'a fresh read of the persisted file must match what was written');
    assert.deepEqual(readBack.gateVerdicts, materialized.gateVerdicts);
  } finally {
    process.env.HOME = priorHome;
  }
});
