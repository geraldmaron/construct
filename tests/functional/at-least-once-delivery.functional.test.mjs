/**
 * tests/functional/at-least-once-delivery.functional.test.mjs — construct-4uxq0.11.5
 *
 * Acceptance suite for at-least-once tick/queue delivery semantics: duplicate
 * triggers, duplicate delivery, worker crash, expired leases, daemon restart,
 * and sleep/wake (heartbeat loss) against PostgresIntakeQueue's lease machinery.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PostgresIntakeQueue } from '../../lib/queue/pg-queue.mjs';
import { createFakePgQueueSql } from '../helpers/fake-pg-queue-sql.mjs';

function sampleEntry(id, extra = {}) {
  return { id, intake: { sourcePath: `/tmp/${id}.md` }, ...extra };
}

function makeQueue(leaseSeconds = 100) {
  const sql = createFakePgQueueSql();
  return {
    sql,
    queue: new PostgresIntakeQueue({ sql, project: 'p', tenantId: 'local', leaseSeconds }),
  };
}

test('duplicate trigger: stable item id upserts instead of duplicating pending rows', async () => {
  const { queue } = makeQueue();
  const entry = sampleEntry('pkt-dup-trigger', { triage: { intakeType: 'note' } });

  await queue.enqueue(entry);
  await queue.enqueue({ ...entry, triage: { intakeType: 'note', rdStage: 'frame' } });

  const pending = await queue.listPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, 'pkt-dup-trigger');
  assert.equal(pending[0].triage.rdStage, 'frame');
});

test('duplicate queue delivery: same executionKey on markProcessed is idempotent', async () => {
  const { queue } = makeQueue();
  await queue.enqueue(sampleEntry('pkt-dup-deliver'));
  await queue.claim({ claimedBy: 'worker-a' });

  const first = await queue.markProcessed('pkt-dup-deliver', {
    processedBy: 'worker-a',
    executionKey: 'exec-fingerprint-1',
  });
  assert.deepEqual(first, { id: 'pkt-dup-deliver' });

  const replay = await queue.markProcessed('pkt-dup-deliver', {
    processedBy: 'worker-a',
    executionKey: 'exec-fingerprint-1',
  });
  assert.deepEqual(replay, { id: 'pkt-dup-deliver', idempotent: true });

  const differentKey = await queue.markProcessed('pkt-dup-deliver', {
    processedBy: 'worker-a',
    executionKey: 'exec-fingerprint-2',
  });
  assert.equal(differentKey, null);
  assert.equal((await queue.read('pkt-dup-deliver')).status, 'processed');
});

test('worker crash: expired lease allows exactly one reclaim and increments attempt', async () => {
  const { sql, queue } = makeQueue(100);
  await queue.enqueue({ ...sampleEntry('pkt-crash'), maxAttempts: 3 });

  const first = await queue.claim({ claimedBy: 'worker-a' });
  assert.equal(first.attempt, 1);

  sql.state.find('p', 'local', 'intake', 'pkt-crash').leaseExpiresAt = Date.now() - 1000;

  const race = await Promise.all([
    queue.claim({ claimedBy: 'worker-b' }),
    queue.claim({ claimedBy: 'worker-c' }),
  ]);
  const reclaimed = race.filter(Boolean);
  assert.equal(reclaimed.length, 1);
  assert.equal(reclaimed[0].id, 'pkt-crash');
  assert.equal(reclaimed[0].attempt, 2);
});

test('expired lease without heartbeat does not reclaim while lease is still live', async () => {
  const { sql, queue } = makeQueue(100);
  await queue.enqueue(sampleEntry('pkt-live-lease'));
  await queue.claim({ claimedBy: 'worker-a' });

  const row = sql.state.find('p', 'local', 'intake', 'pkt-live-lease');
  assert.ok(row.leaseExpiresAt > Date.now());

  const blocked = await queue.claim({ claimedBy: 'worker-b' });
  assert.equal(blocked, null);
});

test('daemon restart: unheartbeated claim becomes reclaimable after lease expiry', async () => {
  const { sql, queue } = makeQueue(30);
  await queue.enqueue(sampleEntry('pkt-restart'));
  const before = await queue.claim({ claimedBy: 'daemon-worker' });
  assert.equal(before.id, 'pkt-restart');

  sql.state.find('p', 'local', 'intake', 'pkt-restart').leaseExpiresAt = Date.now() - 1;

  const afterRestart = await queue.claim({ claimedBy: 'daemon-worker-2' });
  assert.equal(afterRestart.id, 'pkt-restart');
  assert.equal(afterRestart.attempt, 2);
});

test('sleep/wake: heartbeat renewal prevents reclaim; loss of heartbeat allows reclaim', async () => {
  const { sql, queue } = makeQueue(60);
  await queue.enqueue(sampleEntry('pkt-sleep'));
  await queue.claim({ claimedBy: 'worker-a', leaseSeconds: 30 });

  const renewed = await queue.heartbeat('pkt-sleep', { workerId: 'worker-a', leaseSeconds: 120 });
  assert.equal(renewed.renewed, true);

  sql.state.find('p', 'local', 'intake', 'pkt-sleep').leaseExpiresAt = Date.now() - 1;

  const reclaimed = await queue.claim({ claimedBy: 'worker-b' });
  assert.equal(reclaimed.id, 'pkt-sleep');
  assert.equal(reclaimed.attempt, 2);
});

test('parallel duplicate triggers into distinct ids still produce one claim each', async () => {
  const { queue } = makeQueue();
  const ids = ['pkt-a', 'pkt-b', 'pkt-c'];
  await Promise.all(ids.map((id) => queue.enqueue(sampleEntry(id))));

  const claims = await Promise.all(
    Array.from({ length: 5 }, (_, i) => queue.claim({ claimedBy: `worker-${i}` })),
  );
  const claimedIds = claims.filter(Boolean).map((row) => row.id).sort();
  assert.deepEqual(claimedIds, ids);
});
