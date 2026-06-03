/**
 * tests/orchestration-run-store-sqlite.test.mjs — SQLite run store (Mode-B).
 *
 * The whole suite gates on sqliteAvailable(): node:sqlite exists only on Node
 * >=22.5, and the CI matrix also runs Node 20. When unavailable, a single passing
 * test records the skip so Node 20 CI stays green; when available, saveRun /
 * loadRun / listRuns round-trip a run and a missing runId resolves to null.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sqliteAvailable, createSqliteRunStore } from '../lib/orchestration/run-store-sqlite.mjs';

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-orch-sqlite-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

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

if (!sqliteAvailable()) {
  test('sqlite run store skipped — node:sqlite unavailable (Node <22.5)', () => {
    assert.equal(sqliteAvailable(), false);
  });
} else {
  test('saveRun/loadRun round-trips a run', () => {
    const store = createSqliteRunStore({ cwd: project() });
    const run = sampleRun('run-sqlite-1');
    store.saveRun(run);
    const loaded = store.loadRun('run-sqlite-1');
    assert.equal(loaded.runId, 'run-sqlite-1');
    assert.equal(loaded.status, 'completed');
    assert.equal(loaded.tasks[0].role, 'cx-engineer');
  });

  test('saveRun upserts on the same runId', () => {
    const store = createSqliteRunStore({ cwd: project() });
    store.saveRun(sampleRun('run-sqlite-2'));
    const updated = { ...sampleRun('run-sqlite-2'), status: 'completed-with-failures' };
    store.saveRun(updated);
    assert.equal(store.loadRun('run-sqlite-2').status, 'completed-with-failures');
  });

  test('listRuns returns summaries newest-first and respects limit', () => {
    const store = createSqliteRunStore({ cwd: project() });
    store.saveRun({ ...sampleRun('run-sqlite-a'), createdAt: '2026-01-01T00:00:00.000Z' });
    store.saveRun({ ...sampleRun('run-sqlite-b'), createdAt: '2026-02-01T00:00:00.000Z' });
    const runs = store.listRuns({ limit: 1 });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].runId, 'run-sqlite-b');
    assert.equal(runs[0].executionMode, 'construct-orchestrated');
  });

  test('loadRun on a missing runId returns null', () => {
    const store = createSqliteRunStore({ cwd: project() });
    assert.equal(store.loadRun('nope'), null);
    assert.equal(store.loadRun(''), null);
  });
}
