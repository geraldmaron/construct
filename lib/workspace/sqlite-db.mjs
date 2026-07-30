/**
 * lib/workspace/sqlite-db.mjs — SQLite connection for the Workspace domain
 * store (design doc §5).
 *
 * Lazy node:sqlite import behind sqliteAvailable(), the same Node >=22.5
 * compatibility boundary lib/orchestration/run-store-sqlite.mjs and
 * lib/graph/relational/sqlite-db.mjs already established — the import stays
 * inside a function, never at module top level, so Node 20 in the CI matrix
 * never touches the unavailable builtin. One workspace.db file per project
 * under the machine-scoped state root (resolveStateDir), mirroring
 * graph.db's exact placement pattern. Foreign keys are ON here (unlike the
 * graph store's deliberate OFF): a construct_workspace_members row is always
 * written after its construct_workspaces row already exists through this
 * module's own API, so there is no "child staged before parent" case the
 * graph store's edges-before-nodes build path has to accommodate.
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveStateDir } from '../state-root.mjs';
import { runWorkspaceMigrations } from './migrate-sqlite.mjs';

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
 *   existence check (workspaceDbExists) that must have zero filesystem side
 *   effects.
 */
export function workspaceDbPath(rootDir, { ensureDir = true } = {}) {
  return path.join(resolveStateDir(rootDir, 'workspace', { ensureDir }), 'workspace.db');
}

/**
 * Whether a workspace.db file already exists for this project, without
 * creating the state directory or the file as a side effect of asking.
 */
export function workspaceDbExists(rootDir) {
  return existsSync(workspaceDbPath(rootDir, { ensureDir: false }));
}

/**
 * Open (creating and migrating if needed) the workspace.db connection for a
 * project. Callers are responsible for closing the handle they open — prefer
 * withWorkspaceDb below.
 *
 * @param {string} rootDir
 * @returns {import('node:sqlite').DatabaseSync}
 */
export function openWorkspaceDb(rootDir) {
  const DatabaseSync = loadDatabaseSync();
  if (!DatabaseSync) {
    const err = new Error('The Workspace domain store requires Node >=22.5 (node:sqlite is unavailable on this runtime).');
    err.code = 'SQLITE_UNAVAILABLE';
    err.remediation = 'Upgrade to Node >=22.5.';
    throw err;
  }
  const db = new DatabaseSync(workspaceDbPath(rootDir));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  runWorkspaceMigrations(db);
  return db;
}

/**
 * Open a connection for the duration of `fn` and close it afterward,
 * regardless of outcome.
 */
export function withWorkspaceDb(rootDir, fn) {
  const db = openWorkspaceDb(rootDir);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
