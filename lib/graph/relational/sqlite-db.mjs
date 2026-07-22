/**
 * lib/graph/relational/sqlite-db.mjs — SQLite connection for the relational
 * graph store (the embedded/solo backend, design doc §2 constraint 1).
 *
 * Lazy node:sqlite import: the module exists only on Node >=22.5, but the CI
 * matrix also runs Node 20, so the import is inside a function, never at
 * module top level — the identical boundary lib/orchestration/run-store-
 * sqlite.mjs already established. One graph.db file per project under the
 * machine-scoped state root (ADR-0066, resolveStateDir), replacing the
 * project-local `.construct/graph/` JSONL files as the host graph's source of
 * truth; lib/graph/relational/export.mjs still refreshes a JSONL snapshot at
 * that legacy path on every build for diff-clean review.
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveStateDir } from '../../state-root.mjs';
import { runSqliteMigrations } from './migrate-sqlite.mjs';

const require = createRequire(import.meta.url);

let cachedDatabaseSync;

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

/**
 * @param {string} rootDir
 * @param {{ ensureDir?: boolean }} [opts] — `ensureDir: false` (default true)
 *   resolves the path without creating the state directory, for a pure
 *   existence check (graphDbExists) that must have zero filesystem side
 *   effects — a caller merely asking "is there a graph yet" must not itself
 *   cause one to spring into existence, which would otherwise make every
 *   read-only .exists check write into the machine-scoped state root.
 */
export function graphDbPath(rootDir, { ensureDir = true } = {}) {
  return path.join(resolveStateDir(rootDir, 'graph', { ensureDir }), 'graph.db');
}

/**
 * Whether a graph.db file already exists for this project, without creating
 * the state directory or the file as a side effect of asking.
 */
export function graphDbExists(rootDir) {
  return existsSync(graphDbPath(rootDir, { ensureDir: false }));
}

/**
 * Open (creating and migrating if needed) the graph.db connection for a
 * project. WAL mode so the incremental applier's writes never block a
 * concurrent reader (query/impact/doctor). Callers are responsible for
 * closing the handle they open.
 *
 * @param {string} rootDir
 * @returns {import('node:sqlite').DatabaseSync}
 */
export function openGraphDb(rootDir) {
  const DatabaseSync = loadDatabaseSync();
  if (!DatabaseSync) {
    const err = new Error('The relational graph store requires Node >=22.5 (node:sqlite is unavailable on this runtime).');
    err.code = 'SQLITE_UNAVAILABLE';
    err.remediation = 'Upgrade to Node >=22.5. The legacy JSONL target-graph path (build-target-graph.mjs) is unaffected.';
    throw err;
  }
  const db = new DatabaseSync(graphDbPath(rootDir));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = OFF');
  runSqliteMigrations(db);
  return db;
}

/**
 * Open a connection for the duration of `fn` and close it afterward,
 * regardless of outcome — every relational-store call site uses this instead
 * of managing open/close by hand.
 */
export function withGraphDb(rootDir, fn) {
  const db = openGraphDb(rootDir);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
