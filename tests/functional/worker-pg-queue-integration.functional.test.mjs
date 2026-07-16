/**
 * tests/functional/worker-pg-queue-integration.functional.test.mjs — real
 * PostgresIntakeQueue driven through the real runWorkerLoop.
 *
 * construct-4uxq0.13.4: tests/worker-entrypoint.test.mjs and
 * tests/pg-queue*.test.mjs each cover their own module in isolation — the
 * worker tests hand-roll stub/spy queues, and the pg-queue tests call
 * heartbeat()/fail() directly, never through the worker loop. Neither
 * proves the ADR-0089 wiring (lib/worker/entrypoint.mjs calling
 * queue.heartbeat() during execution and queue.fail() on error) against the
 * actual PostgresIntakeQueue class. This suite constructs a real
 * PostgresIntakeQueue (lib/queue/pg-queue.mjs) over the same in-memory `sql`
 * substrate tests/pg-queue.test.mjs uses (tests/helpers/fake-pg-queue-sql.mjs
 * — reused rather than reinvented), drives it through the real
 * runWorkerLoop, and asserts on the fake sql's persisted row state — the
 * same state a live Postgres backend would hold — rather than on spy call
 * counts.
 *
 * runWorkerLoop writes trace events through the machine-scoped state root
 * (ADR-0066); CX_HOME_OVERRIDE is pinned per test per the same pattern as
 * tests/worker-entrypoint.test.mjs.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runWorkerLoop } from '../../lib/worker/entrypoint.mjs';
import { PostgresIntakeQueue } from '../../lib/queue/pg-queue.mjs';
import { createFakePgQueueSql } from '../helpers/fake-pg-queue-sql.mjs';

let projectRoot;
let originalCwd;
let prevHomeOverride;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-worker-pgqueue-'));
  originalCwd = process.cwd();
  process.chdir(projectRoot);
  prevHomeOverride = process.env.CX_HOME_OVERRIDE;
  process.env.CX_HOME_OVERRIDE = projectRoot;
});

afterEach(() => {
  process.chdir(originalCwd);
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function sampleEntry(id, extra = {}) {
  return { id, intake: { sourcePath: `/tmp/${id}.md`, project: 'test' }, ...extra };
}

describe('runWorkerLoop x PostgresIntakeQueue — real class, real loop (construct-4uxq0.13.4)', () => {
  it('claim -> execute -> heartbeat -> complete: heartbeat renewals land in the queue row while the job is in flight', async () => {
    const sql = createFakePgQueueSql();
    const queue = new PostgresIntakeQueue({ sql, project: 'test', tenantId: 'local', leaseSeconds: 1 });
    await queue.enqueue(sampleEntry('pkt-heartbeat', { workerCommand: 'sleep 0.4' }));

    const loopPromise = runWorkerLoop({
      rootDir: projectRoot,
      workspace: projectRoot,
      project: 'test',
      queue,
      idleTimeoutSeconds: 0,
      pollIntervalMs: 10,
      stopAfter: 1,
      heartbeatIntervalMs: 50,
    });

    // Sample the fake sql's actual row store (the same store
    // tests/pg-queue.test.mjs asserts against) mid-flight — this is the
    // queue's real persisted state, not a spy call log.
    await new Promise((resolve) => setTimeout(resolve, 120));
    const rowMidFlight = sql.state.find('test', 'local', 'intake', 'pkt-heartbeat');
    assert.ok(rowMidFlight, 'claimed row exists in the persisted store');
    assert.equal(rowMidFlight.status, 'claimed');
    const leaseAfterFirstWindow = rowMidFlight.leaseExpiresAt;

    await new Promise((resolve) => setTimeout(resolve, 120));
    const rowLater = sql.state.find('test', 'local', 'intake', 'pkt-heartbeat');
    assert.ok(
      rowLater.leaseExpiresAt > leaseAfterFirstWindow,
      'a real heartbeat() call renewed lease_expires_at on the persisted row during in-flight execution',
    );

    const summary = await loopPromise;
    assert.equal(summary.processed, 1);
    assert.equal(summary.skipped, 0);

    const finalRow = sql.state.find('test', 'local', 'intake', 'pkt-heartbeat');
    assert.equal(finalRow.status, 'processed', 'markProcessed landed on the real row after the heartbeat loop stopped');
    assert.equal(finalRow.claimedBy, null);
    assert.equal(finalRow.leaseExpiresAt, null, 'markProcessed cleared the lease on completion');

    const persisted = await queue.read('pkt-heartbeat');
    assert.equal(persisted.status, 'processed');
    // processedBy lands on the raw row (processed_by column in real
    // Postgres), not inside the jsonb payload — matches pg-queue.mjs's
    // markProcessed(), which only writes {status, processedAt, executionKey}
    // into the payload itself.
    assert.match(finalRow.processedBy, /worker-/);
  });

  it('claim -> execute -> fail: a real exec-time exception releases the claim via queue.fail(), observed on the persisted row', async () => {
    const sql = createFakePgQueueSql();
    const queue = new PostgresIntakeQueue({ sql, project: 'test', tenantId: 'local', leaseSeconds: 100 });
    // No workerCommand and an empty defaultCommand means jobFromPacket
    // resolves job.command to '' — runJob (lib/worker/run.mjs) throws
    // `job.command is required` for real, so processClaim's catch branch
    // calls the real queue.fail(), not a mocked runJob.
    await queue.enqueue({ ...sampleEntry('pkt-fail'), maxAttempts: 3 });

    const summary = await runWorkerLoop({
      rootDir: projectRoot,
      workspace: projectRoot,
      project: 'test',
      queue,
      idleTimeoutSeconds: 0,
      pollIntervalMs: 10,
      stopAfter: 1,
      defaultCommand: '',
    });

    assert.equal(summary.processed, 0);
    assert.equal(summary.skipped, 1);

    const row = sql.state.find('test', 'local', 'intake', 'pkt-fail');
    assert.ok(row, 'row survives the failed attempt (fail() reopens, it does not delete)');
    assert.equal(row.status, 'pending', 'fail() reopened the item for retry — attempt 1 of maxAttempts 3');
    assert.equal(row.attempt, 1);
    assert.equal(row.claimedBy, null, 'fail() released the claim');
    assert.equal(row.leaseExpiresAt, null, 'fail() cleared the lease');
    assert.match(row.terminalReason, /job\.command is required/, 'the real runJob exception message reached queue.fail()');

    const persisted = await queue.read('pkt-fail');
    assert.equal(persisted.status, 'pending');
    assert.match(persisted.lastFailureReason, /worker exec error:.*job\.command is required/);
    assert.match(persisted.failedBy, /worker-/);

    // The item is genuinely reclaimable after fail() — proves fail() left
    // the queue in a state a second worker attempt could pick back up.
    const reclaimed = await queue.claim({ claimedBy: 'worker-retry' });
    assert.equal(reclaimed.id, 'pkt-fail');
    assert.equal(reclaimed.attempt, 2);
  });

  it('claim -> execute -> fail beyond max_attempts: the real queue.fail() dead-letters the row through the worker loop', async () => {
    const sql = createFakePgQueueSql();
    const queue = new PostgresIntakeQueue({ sql, project: 'test', tenantId: 'local', leaseSeconds: 100 });
    await queue.enqueue({ ...sampleEntry('pkt-dlq'), maxAttempts: 1 });

    const summary = await runWorkerLoop({
      rootDir: projectRoot,
      workspace: projectRoot,
      project: 'test',
      queue,
      idleTimeoutSeconds: 0,
      pollIntervalMs: 10,
      stopAfter: 1,
      defaultCommand: '',
    });

    assert.equal(summary.skipped, 1);
    const row = sql.state.find('test', 'local', 'intake', 'pkt-dlq');
    assert.equal(row.status, 'dead_letter', 'attempt (1) reached max_attempts (1) — real fail() dead-lettered it');
    assert.equal(await queue.claim({ claimedBy: 'worker-late' }), null, 'a dead-lettered item is never reclaimable');
  });
});
