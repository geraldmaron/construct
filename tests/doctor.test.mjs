/**
 * tests/doctor.test.mjs — health check and storage descriptor unit tests
 *
 * Tests doctor-related storage descriptor functions from lib/storage/sql-store.mjs and
 * vector-store.mjs. Verifies that configured stores report healthy, fallback availability
 * is correct, and sql/vector descriptors reflect actual configuration state.
 * Run via npm test.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { describeSqlStore, sqlStoreHealth } from '../lib/storage/sql-store.mjs';
import { describeVectorStore } from '../lib/storage/vector-store.mjs';

test('configured sql store is treated as healthy-enough for doctor output', () => {
  const env = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/construct' };
  const store = describeSqlStore(env);
  const health = sqlStoreHealth(env);

  assert.equal(store.configured, true);
  assert.equal(store.sharedReady, true);
  assert.equal(health.status, 'configured');
  assert.match(health.message, /Postgres/);
});

test('configured vector store is detectable without warning semantics', () => {
  const env = { CONSTRUCT_VECTOR_INDEX_PATH: '/tmp/construct-vector-index' };
  const store = describeVectorStore(env);

  assert.equal(store.configured, true);
  assert.equal(store.mode, 'local');
  assert.equal(store.fallbackAvailable, true);
});
