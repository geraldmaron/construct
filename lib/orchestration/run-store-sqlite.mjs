/**
 * lib/orchestration/run-store-sqlite.mjs — SQLite-backed run store (Mode-B).
 *
 * Same saveRun/loadRun/listRuns surface as the filesystem store (run-store.mjs),
 * backed by a single `node:sqlite` database under
 * `.cx/runtime/orchestration/runs.db`. A daemon-grade local store: durable,
 * single-file, queryable, with no Postgres/Docker dependency.
 *
 * Node compatibility boundary: `node:sqlite` exists only on Node >=22.5, but the
 * CI matrix also runs Node 20. So the import is LAZY (inside a function, never at
 * module top level) and `sqliteAvailable()` reports false when it throws. The
 * store factory throws a structured SQLITE_UNAVAILABLE error (with remediation)
 * rather than crashing, so the resolver can fall back to filesystem. Nothing on
 * the default test path statically imports node:sqlite.
 */

import { mkdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const RUNTIME_REL = join('.cx', 'runtime', 'orchestration');

let cachedDatabaseSync;

// The node:sqlite probe is cached and synchronous. createRequire above is a
// plain static import of node:module (always present); only node:sqlite itself
// is loaded lazily here, so Node 20 never touches the unavailable builtin.

function loadDatabaseSync() {
  if (cachedDatabaseSync !== undefined) return cachedDatabaseSync;
  try {
    cachedDatabaseSync = require('node:sqlite').DatabaseSync;
  } catch {
    cachedDatabaseSync = null;
  }
  return cachedDatabaseSync;
}

export function sqliteAvailable() {
  return loadDatabaseSync() != null;
}

function projectRoot(cwd) {
  return isAbsolute(cwd) ? cwd : resolve(cwd);
}

function dbPath(cwd) {
  const dir = join(projectRoot(cwd), RUNTIME_REL);
  mkdirSync(dir, { recursive: true });
  return join(dir, 'runs.db');
}

function openDb(cwd) {
  const DatabaseSync = loadDatabaseSync();
  if (!DatabaseSync) {
    const err = new Error('SQLite run store requires Node >=22.5 (node:sqlite is unavailable on this runtime).');
    err.code = 'SQLITE_UNAVAILABLE';
    err.remediation = 'Upgrade to Node >=22.5, or set orchestration.store to "filesystem" / "postgres".';
    throw err;
  }
  const db = new DatabaseSync(dbPath(cwd));
  db.exec(`CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    created_at TEXT,
    status TEXT,
    execution_mode TEXT,
    json TEXT
  )`);
  return db;
}

/**
 * Build a SQLite-backed run store bound to a project directory.
 *
 * @param {object} opts
 * @param {string} opts.cwd
 * @returns {{ saveRun(run):object, loadRun(runId):object|null, listRuns(opts):Array }}
 */
export function createSqliteRunStore({ cwd = process.cwd() } = {}) {
  const db = openDb(cwd);
  return {
    saveRun(run) {
      const stmt = db.prepare(`INSERT INTO runs (run_id, created_at, status, execution_mode, json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          created_at = excluded.created_at,
          status = excluded.status,
          execution_mode = excluded.execution_mode,
          json = excluded.json`);
      stmt.run(run.runId, run.createdAt || null, run.status || null, run.execution?.executionMode || null, JSON.stringify(run));
      return run;
    },
    loadRun(runId) {
      if (!runId) return null;
      const row = db.prepare('SELECT json FROM runs WHERE run_id = ?').get(runId);
      if (!row || !row.json) return null;
      try {
        return JSON.parse(row.json);
      } catch {
        return null;
      }
    },
    listRuns({ limit = 20 } = {}) {
      const rows = db.prepare('SELECT json FROM runs ORDER BY created_at DESC LIMIT ?').all(limit);
      const out = [];
      for (const row of rows) {
        try {
          const run = JSON.parse(row.json);
          out.push({
            runId: run.runId,
            status: run.status,
            executionMode: run.execution?.executionMode || null,
            createdAt: run.createdAt,
            request: run.request?.summary || null,
          });
        } catch { /* a corrupt row is skipped, not fatal to listing */ }
      }
      return out;
    },
  };
}
