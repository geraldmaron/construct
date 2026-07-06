/**
 * tests/observation-retention.test.mjs — TTL/size eviction for the
 * machine-scoped observations_v1 vector table (construct-rf26.17).
 *
 * Exercises lib/storage/vector-client.mjs's pruneObservations() and
 * lib/storage/admin.mjs's purgeExpiredData() directly against a real
 * temp-dir LanceDB instance (CONSTRUCT_LANCEDB_PATH pinned per test), never
 * touching the developer machine's real $HOME/~/.construct/projects/.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { VectorClient } from '../lib/storage/vector-client.mjs';
import { purgeExpiredData } from '../lib/storage/admin.mjs';

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function tmpLanceDbDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-obs-retention-'));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
  return dir;
}

async function seedObservations(client, count, { ageDaysStart = 100 } = {}) {
  for (let i = 0; i < count; i++) {
    await client.storeObservation({
      id: `obs-${i}`,
      project: 'test-project',
      role: 'engineer',
      category: 'insight',
      summary: `observation ${i}`,
      content: 'body',
      embedding: new Float32Array(256).fill(0.1),
      createdAt: isoDaysAgo(ageDaysStart - i),
    });
  }
}

test('purgeExpiredData is a no-op when the vector index was never provisioned', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-obs-project-'));
  t.after(() => { try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch {} });

  const result = await purgeExpiredData(rootDir, { env: {} });
  assert.equal(result.status, 'skipped');
  assert.equal(fs.existsSync(path.join(rootDir, 'lancedb')), false, 'purge must never materialize the index');
});

test('pruneObservations evicts rows past maxAgeDays and keeps the rest', async (t) => {
  const dbPath = tmpLanceDbDir(t);
  const env = { CONSTRUCT_LANCEDB_PATH: dbPath, CONSTRUCT_EMBEDDING_MODEL: 'hashing' };
  const client = new VectorClient({ env });

  // Five rows spanning 100, 99, 98, 97, 96 days old — a 30-day cap should
  // evict all of them since every row predates the cutoff.
  await seedObservations(client, 3, { ageDaysStart: 100 });
  // One recent row survives the cutoff.
  await client.storeObservation({
    id: 'obs-recent',
    project: 'test-project',
    role: 'engineer',
    category: 'insight',
    summary: 'recent observation',
    content: 'body',
    embedding: new Float32Array(256).fill(0.1),
    createdAt: isoDaysAgo(1),
  });

  const result = await client.pruneObservations({ maxAgeDays: 30 });
  assert.equal(result.evictedCount, 3, 'the three 96-100 day old rows are evicted');
  assert.equal(result.remainingCount, 1, 'the 1-day-old row survives');
  assert.ok(new Date(result.oldestRetainedAt).getTime() > Date.now() - 2 * 24 * 60 * 60 * 1000);
});

test('pruneObservations evicts oldest rows beyond maxRows', async (t) => {
  const dbPath = tmpLanceDbDir(t);
  const env = { CONSTRUCT_LANCEDB_PATH: dbPath, CONSTRUCT_EMBEDDING_MODEL: 'hashing' };
  const client = new VectorClient({ env });

  await seedObservations(client, 10, { ageDaysStart: 10 });

  const result = await client.pruneObservations({ maxRows: 4 });
  assert.equal(result.remainingCount, 4, 'only the 4 most-recent rows remain');
  assert.equal(result.evictedCount, 6, 'the 6 oldest rows are evicted');
});

test('purgeExpiredData reports size, oldest retained entry, and evicted count end to end', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-obs-project-'));
  const dbPath = path.join(rootDir, 'lancedb');
  t.after(() => { try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch {} });

  const env = { CONSTRUCT_LANCEDB_PATH: dbPath, CONSTRUCT_EMBEDDING_MODEL: 'hashing' };
  const client = new VectorClient({ env });
  await seedObservations(client, 5, { ageDaysStart: 200 });

  const result = await purgeExpiredData(rootDir, { env, maxAgeDays: 30, maxRows: 5000 });
  assert.equal(result.status, 'ok');
  assert.equal(result.evictedCount, 5, 'all 5 rows are older than the 30-day cap');
  assert.equal(result.remainingCount, 0);
  assert.equal(result.oldestRetainedAt, null);
  assert.ok(result.sizeBytes >= 0);
  assert.equal(result.maxAgeDays, 30);
});
