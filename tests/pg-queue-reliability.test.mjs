/**
 * tests/pg-queue-reliability.test.mjs — retry, DLQ, cancellation, idempotency contracts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PostgresIntakeQueue } from '../lib/queue/pg-queue.mjs';
import { createFakePgQueueSql } from './helpers/fake-pg-queue-sql.mjs';

function sampleEntry(id, extra = {}) {
  return { id, intake: { sourcePath: `/tmp/${id}.md` }, ...extra };
}

test('fail() reopens pending work under max attempts and dead-letters it beyond max attempts', async () => {
  const sql = createFakePgQueueSql();
  const queue = new PostgresIntakeQueue({ sql, project: 'p', tenantId: 'local', leaseSeconds: 100 });
  await queue.enqueue({ ...sampleEntry('pkt-1'), maxAttempts: 2 });

  const firstClaim = await queue.claim({ claimedBy: 'worker-a' });
  assert.equal(firstClaim.attempt, 1);
  const firstFail = await queue.fail('pkt-1', { workerId: 'worker-a', reason: 'transient' });
  assert.equal(firstFail.deadLettered, false);
  assert.equal(firstFail.status, 'pending');
  assert.equal((await queue.read('pkt-1')).status, 'pending');

  const secondClaim = await queue.claim({ claimedBy: 'worker-b' });
  assert.equal(secondClaim.attempt, 2);
  const secondFail = await queue.fail('pkt-1', { workerId: 'worker-b', reason: 'still broken' });
  assert.equal(secondFail.deadLettered, true);
  assert.equal(secondFail.status, 'dead_letter');
  assert.equal((await queue.read('pkt-1')).status, 'dead_letter');
});

test('requestCancellation marks a live item and blocks claim/heartbeat semantics from hiding it', async () => {
  const sql = createFakePgQueueSql();
  const queue = new PostgresIntakeQueue({ sql, project: 'p', tenantId: 'local' });
  await queue.enqueue(sampleEntry('pkt-2'));
  await queue.claim({ claimedBy: 'worker-a' });

  const result = await queue.requestCancellation('pkt-2', { requestedBy: 'worker-b', reason: 'superseded' });
  assert.deepEqual(result, { id: 'pkt-2', cancellationRequested: true });

  const stored = await queue.read('pkt-2');
  assert.equal(stored.cancelRequested, true);
  assert.equal(stored.cancellationReason, 'superseded');

  const heartbeat = await queue.heartbeat('pkt-2', { workerId: 'worker-a' });
  assert.equal(heartbeat.renewed, false);
  assert.equal(heartbeat.cancelled, true);
  assert.equal(heartbeat.reason, 'superseded');
});

test('claim protocol will not reclaim expired work beyond max attempts', async () => {
  const sql = createFakePgQueueSql();
  const queue = new PostgresIntakeQueue({ sql, project: 'p', tenantId: 'local', leaseSeconds: 100 });
  await queue.enqueue({ ...sampleEntry('pkt-3'), maxAttempts: 1 });

  const claimed = await queue.claim({ claimedBy: 'worker-a' });
  assert.equal(claimed.attempt, 1);

  sql.state.find('p', 'local', 'intake', 'pkt-3').leaseExpiresAt = Date.now() - 1000;
  const reclaimed = await queue.claim({ claimedBy: 'worker-b' });
  assert.equal(reclaimed, null, 'attempt already equals max_attempts; expired lease must not make it reclaimable');
});

test('markProcessed carries an execution key for idempotent completion', async () => {
  const sql = createFakePgQueueSql();
  const queue = new PostgresIntakeQueue({ sql, project: 'p', tenantId: 'local' });
  await queue.enqueue(sampleEntry('pkt-4'));
  await queue.claim({ claimedBy: 'worker-a' });

  const first = await queue.markProcessed('pkt-4', { processedBy: 'worker-a', executionKey: 'exec-1' });
  assert.deepEqual(first, { id: 'pkt-4' });
  assert.equal((await queue.read('pkt-4')).status, 'processed');

  const replay = await queue.markProcessed('pkt-4', { processedBy: 'worker-a', executionKey: 'exec-1' });
  assert.deepEqual(replay, { id: 'pkt-4', idempotent: true }, 'same execution key short-circuits without re-running the terminal update');

  const differentKey = await queue.markProcessed('pkt-4', { processedBy: 'worker-a', executionKey: 'exec-2' });
  assert.equal(differentKey, null, 'an already-processed row stays terminal for a new execution key');
});
