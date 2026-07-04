/**
 * tests/pg-queue.test.mjs — Postgres queue provider contract checks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { PostgresIntakeQueue } from '../lib/queue/pg-queue.mjs';
import { listQueueProviders, findQueueProvider } from '../lib/intake/queue-registry.mjs';

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

test('claim protocol is row-locked with SKIP LOCKED and lease reclamation predicate', () => {
  const source = fs.readFileSync(new URL('../lib/queue/pg-queue.mjs', import.meta.url), 'utf8');
  assert.match(source, /FOR UPDATE SKIP LOCKED/);
  assert.match(source, /status = 'claimed' AND lease_expires_at <= now\(\)/);
  assert.match(source, /INSERT INTO construct_queue_claims/);
});

test('queue migration carries durable status and lease columns', () => {
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
});
