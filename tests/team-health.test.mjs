/**
 * tests/team-health.test.mjs — team queue/worker health read model.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeTeamHealth } from '../lib/team/health.mjs';

function fakeSql({ queueRows = [], workerRows = [] } = {}) {
  function query(strings, ...values) {
    const text = Array.isArray(strings) ? strings.join('?') : String(strings);
    if (/SELECT id, applied_at FROM construct_schema_migrations/i.test(text)) return Promise.resolve([]);
    if (/INSERT INTO construct_schema_migrations/i.test(text)) return Promise.resolve([]);
    if (/GROUP BY status/i.test(text)) return Promise.resolve(queueRows);
    if (/FROM construct_workers/i.test(text)) return Promise.resolve(workerRows);
    return Promise.resolve([]);
  }
  query.unsafe = async () => {};
  query.begin = async (fn) => fn(query);
  query.json = (value) => value;
  return query;
}

test('summarizeTeamHealth reports healthy queue and worker state', async () => {
  const health = await summarizeTeamHealth({
    rootDir: '/tmp/project-a',
    env: { CONSTRUCT_TENANT_ID: 'local' },
    sql: fakeSql({
      queueRows: [{ status: 'pending', count: 2 }, { status: 'claimed', count: 1 }],
      workerRows: [{ worker_id: 'w1', status: 'active', stale: false, capabilities: [], metadata: {}, lease_ttl_seconds: 120 }],
    }),
  });
  assert.equal(health.status, 'healthy');
  assert.equal(health.queue.pending, 2);
  assert.equal(health.activeWorkers, 1);
  assert.equal(health.staleWorkers, 0);
});

test('summarizeTeamHealth degrades on dead-letter queue depth and stale workers', async () => {
  const health = await summarizeTeamHealth({
    rootDir: '/tmp/project-a',
    env: { CONSTRUCT_TENANT_ID: 'local' },
    sql: fakeSql({
      queueRows: [{ status: 'dead_letter', count: 1 }],
      workerRows: [{ worker_id: 'w-stale', status: 'active', stale: true, capabilities: [], metadata: {}, lease_ttl_seconds: 120 }],
    }),
  });
  assert.equal(health.status, 'degraded');
  assert.equal(health.deadLetter, 1);
  assert.equal(health.staleWorkers, 1);
  assert.match(health.summary, /dead-letter/);
});

test('summarizeTeamHealth reports unavailable when no SQL client exists', async () => {
  const health = await summarizeTeamHealth({ env: {}, sql: null });
  assert.equal(health.status, 'unavailable');
  assert.equal(health.reason, 'postgres-unavailable');
});
