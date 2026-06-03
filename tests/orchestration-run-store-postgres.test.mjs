/**
 * tests/orchestration-run-store-postgres.test.mjs — Postgres run store (Mode-C).
 *
 * Gates on createSqlClient(env) being non-null: with no DATABASE_URL (the default
 * CI and local test posture) a single passing test records the skip; when a
 * client is available the store schema is ensured and a run round-trips through
 * saveRun / loadRun / listRuns.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSqlClient, closeSqlClient } from '../lib/storage/backend.mjs';
import { PostgresRunStore } from '../lib/orchestration/run-store-postgres.mjs';

function sampleRun(id) {
  return {
    runId: id,
    createdAt: new Date().toISOString(),
    status: 'completed',
    execution: { executionMode: 'construct-orchestrated' },
    request: { summary: `summary for ${id}` },
    tasks: [{ id: 't1', role: 'cx-engineer', status: 'done' }],
  };
}

const sql = createSqlClient(process.env);

if (!sql) {
  test('postgres run store skipped — no DATABASE_URL / sql client', () => {
    assert.equal(createSqlClient(process.env), null);
  });

  test('constructor rejects a missing sql client', () => {
    assert.throws(() => new PostgresRunStore({ project: 'p' }), /sql client is required/);
    assert.throws(() => new PostgresRunStore({ sql: {} }), /project is required/);
  });
} else {
  test.after(async () => { await closeSqlClient(sql); });

  test('saveRun/loadRun/listRuns round-trip through Postgres', async () => {
    const store = new PostgresRunStore({ sql, project: 'cx-test-orchestration' });
    await store.ensureSchema();
    const id = `run-pg-${Date.now()}`;
    await store.saveRun(sampleRun(id));
    const loaded = await store.loadRun(id);
    assert.equal(loaded.runId, id);
    assert.equal(loaded.status, 'completed');
    const runs = await store.listRuns({ limit: 5 });
    assert.ok(runs.some((r) => r.runId === id));
    await sql`DELETE FROM construct_orchestration_runs WHERE run_id = ${id} AND project = 'cx-test-orchestration'`;
  });
}
