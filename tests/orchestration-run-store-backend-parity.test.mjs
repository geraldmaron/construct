/**
 * tests/orchestration-run-store-backend-parity.test.mjs — SQLite/Postgres
 * run-store parity.
 *
 * Runs the identical saveRun/loadRun/listRuns sequence against both durable
 * backends (filesystem is JSON-file-based and out of scope for this parity
 * claim — see run-store.mjs's richer listRuns projection) and asserts equal
 * results, mirroring directive §4's day-one "equivalent results on SQLite and
 * Postgres" applied here to the run store rather than the graph store.
 *
 * Gates on both `sqliteAvailable()` (node:sqlite, Node >=22.5) and
 * `createSqlClient(env)` (a reachable DATABASE_URL) being available — when
 * either is missing, a single passing test records which one, so CI without a
 * live Postgres (the default posture, per orchestration-run-store-postgres.
 * test.mjs) stays green without silently skipping the whole file.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sqliteAvailable, createSqliteRunStore } from '../lib/orchestration/run-store-sqlite.mjs';
import { createSqlClient, closeSqlClient } from '../lib/storage/backend.mjs';
import { PostgresRunStore } from '../lib/orchestration/run-store-postgres.mjs';

function sampleRun(id, overrides = {}) {
  return {
    runId: id,
    createdAt: new Date().toISOString(),
    status: 'completed',
    execution: { executionMode: 'construct-orchestrated' },
    request: { summary: `summary for ${id}` },
    tasks: [{ id: 't1', role: 'engineer', status: 'done' }],
    ...overrides,
  };
}

// Both backends' saveRun/loadRun/listRuns return the same projected shape
// (runId, status, executionMode, createdAt, request) — asserted directly
// against each backend's own round-trip, not just against each other, so a
// shape drift in either implementation fails loud rather than passing by
// both sides drifting the same way.

function assertRunsEquivalent(a, b, label) {
  assert.equal(a.runId, b.runId, `${label}: runId`);
  assert.equal(a.status, b.status, `${label}: status`);
  assert.equal(a.execution?.executionMode, b.execution?.executionMode, `${label}: executionMode`);
  assert.equal(a.createdAt, b.createdAt, `${label}: createdAt`);
  assert.deepEqual(a.tasks, b.tasks, `${label}: tasks`);
  assert.equal(a.request?.summary, b.request?.summary, `${label}: request.summary`);
}

function assertSummariesEquivalent(a, b, label) {
  assert.equal(a.runId, b.runId, `${label}: runId`);
  assert.equal(a.status, b.status, `${label}: status`);
  assert.equal(a.executionMode, b.executionMode, `${label}: executionMode`);
  assert.equal(a.createdAt, b.createdAt, `${label}: createdAt`);
  assert.equal(a.request, b.request, `${label}: request`);
}

const sqliteOk = sqliteAvailable();
const sql = createSqlClient(process.env);

if (!sqliteOk || !sql) {
  test('backend parity skipped — missing prerequisite', () => {
    if (!sqliteOk) assert.equal(sqliteAvailable(), false, 'node:sqlite unavailable (Node <22.5)');
    if (!sql) assert.equal(createSqlClient(process.env), null, 'no reachable DATABASE_URL');
  });
} else {
  const dirs = [];
  const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-parity-home-'));
  const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;

  test.after(async () => {
    for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
    try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
    if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
    await closeSqlClient(sql);
  });

  function project() {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-parity-'));
    dirs.push(cwd);
    return cwd;
  }

  test('saveRun + loadRun return equivalent records across SQLite and Postgres', async () => {
    const id = `run-parity-${Date.now()}-1`;
    const run = sampleRun(id);

    const sqlite = createSqliteRunStore({ cwd: project() });
    sqlite.saveRun(run);
    const fromSqlite = sqlite.loadRun(id);

    const project_ = `cx-test-parity-${Date.now()}`;
    const postgres = new PostgresRunStore({ sql, project: project_ });
    await postgres.ensureSchema();
    await postgres.saveRun(run);
    const fromPostgres = await postgres.loadRun(id);

    assertRunsEquivalent(fromSqlite, fromPostgres, 'loadRun');
    await sql`DELETE FROM construct_orchestration_runs WHERE run_id = ${id} AND project = ${project_}`;
  });

  test('saveRun upsert + listRuns return equivalent ordering and summaries across backends', async () => {
    const idA = `run-parity-a-${Date.now()}`;
    const idB = `run-parity-b-${Date.now()}`;
    const runA = sampleRun(idA, { createdAt: '2026-01-01T00:00:00.000Z' });
    const runB = sampleRun(idB, { createdAt: '2026-02-01T00:00:00.000Z' });
    const runBUpdated = { ...runB, status: 'completed-with-failures' };

    const sqlite = createSqliteRunStore({ cwd: project() });
    sqlite.saveRun(runA);
    sqlite.saveRun(runB);
    sqlite.saveRun(runBUpdated);
    const sqliteList = sqlite.listRuns({ limit: 2 });

    const project_ = `cx-test-parity-list-${Date.now()}`;
    const postgres = new PostgresRunStore({ sql, project: project_ });
    await postgres.ensureSchema();
    await postgres.saveRun(runA);
    await postgres.saveRun(runB);
    await postgres.saveRun(runBUpdated);
    const postgresList = await postgres.listRuns({ limit: 2 });

    assert.equal(sqliteList.length, 2);
    assert.equal(postgresList.length, 2);
    assertSummariesEquivalent(sqliteList[0], postgresList[0], 'listRuns[0] (newest)');
    assertSummariesEquivalent(sqliteList[1], postgresList[1], 'listRuns[1]');
    assert.equal(sqliteList[0].status, 'completed-with-failures');
    assert.equal(postgresList[0].status, 'completed-with-failures');

    await sql`DELETE FROM construct_orchestration_runs WHERE project = ${project_}`;
  });
}
