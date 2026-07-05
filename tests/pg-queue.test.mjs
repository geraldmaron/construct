/**
 * tests/pg-queue.test.mjs — Postgres queue provider contract checks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { PostgresIntakeQueue } from '../lib/queue/pg-queue.mjs';
import { listQueueProviders, findQueueProvider } from '../lib/intake/queue-registry.mjs';
import { createFakePgQueueSql } from './helpers/fake-pg-queue-sql.mjs';

function sampleEntry(id, extra = {}) {
  return { id, intake: { sourcePath: `/tmp/${id}.md` }, ...extra };
}

test('postgres queue provider is registered as kind:queue', () => {
  const provider = findQueueProvider('postgres', { rootDir: process.cwd(), env: process.env });
  assert.ok(provider);
  assert.equal(provider.kind, 'queue');
  assert.equal(provider.id, 'postgres');
  assert.ok(listQueueProviders().some((m) => m.id === 'postgres'));
});

test('PostgresIntakeQueue constructor validates required substrate', () => {
  assert.throws(() => new PostgresIntakeQueue({ project: 'p' }), /sql client is required/);
  assert.throws(() => new PostgresIntakeQueue({ sql: {} }), /project is required/);
});

test('claim protocol is row-locked: two concurrent claimers on one item, only one wins', async () => {
  const sql = createFakePgQueueSql();
  const queue = new PostgresIntakeQueue({ sql, project: 'p', tenantId: 'local' });
  await queue.enqueue(sampleEntry('pkt-1'));

  const [first, second] = await Promise.all([
    queue.claim({ claimedBy: 'worker-a' }),
    queue.claim({ claimedBy: 'worker-b' }),
  ]);
  const winners = [first, second].filter(Boolean);
  assert.equal(winners.length, 1, 'exactly one concurrent claimer gets the item');
  assert.equal(winners[0].id, 'pkt-1');
  assert.equal(sql.state.claims.length, 1, 'exactly one row landed in construct_queue_claims');
});

test('claim protocol reclaims an item only after its lease expires', async () => {
  const sql = createFakePgQueueSql();
  const queue = new PostgresIntakeQueue({ sql, project: 'p', tenantId: 'local', leaseSeconds: 100 });
  await queue.enqueue({ ...sampleEntry('pkt-2'), maxAttempts: 2 });

  const claimed = await queue.claim({ claimedBy: 'worker-a' });
  assert.equal(claimed.attempt, 1);
  assert.equal(await queue.claim({ claimedBy: 'worker-b' }), null, 'live lease blocks reclamation');

  sql.state.find('p', 'local', 'intake', 'pkt-2').leaseExpiresAt = Date.now() - 1000;
  const reclaimed = await queue.claim({ claimedBy: 'worker-b' });
  assert.equal(reclaimed.id, 'pkt-2');
  assert.equal(reclaimed.attempt, 2);
});

test('queue migration carries durable status and lease columns and applies through the real migration runner', async () => {
  const migration = fs.readFileSync(new URL('../lib/db/migrations/002_queue_provider.sql', import.meta.url), 'utf8');
  for (const token of [
    'construct_queue_items',
    'construct_queue_claims',
    'awaiting_approval',
    'dead_letter',
    'worker_id',
    'lease_expires_at',
    'attempt',
  ]) {
    assert.match(migration, new RegExp(token));
  }

  const sql = createFakePgQueueSql();
  const queue = new PostgresIntakeQueue({ sql, project: 'p', tenantId: 'local' });
  await queue.ensureSchema();
  assert.ok(sql.state.migrationsApplied.has('002_queue_provider'), 'ensureSchema runs the queue-provider migration');
});
