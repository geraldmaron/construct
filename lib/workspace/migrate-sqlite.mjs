/**
 * lib/workspace/migrate-sqlite.mjs — SQLite migration runner for the
 * Workspace domain store.
 *
 * Mirrors lib/graph/relational/migrate-sqlite.mjs's numbered-file /
 * transactional-apply / applied-ledger shape, with its own migrations
 * directory and its own migrations table (construct_workspace_schema_
 * migrations) — a dedicated runner rather than sharing lib/db/migrate-
 * sqlite.mjs's directory/ledger keeps this subsystem's schema numbering
 * independent of the orchestration run store's, the same reason the graph
 * store has its own runner rather than sharing that one (design doc §5).
 * Every schema change here is a new numbered file, never an edit to
 * 001_workspace_foundation.sql — the inline unversioned CREATE TABLE the
 * disposition-matrix audit flagged on the run store (D5/C2) is exactly the
 * anti-pattern this avoids.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(DIR, 'migrations');
export const MIGRATIONS_TABLE = 'construct_workspace_schema_migrations';

function migrationId(filePath) {
  return path.basename(filePath).replace(/\.sql$/i, '');
}

export function listMigrationFiles({ migrationsDir = MIGRATIONS_DIR } = {}) {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs.readdirSync(migrationsDir)
    .filter((name) => /^\d+_.+\.sql$/i.test(name))
    .sort()
    .map((name) => path.join(migrationsDir, name));
}

export function ensureMigrationsTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
}

export function getAppliedMigrations(db) {
  ensureMigrationsTable(db);
  return db.prepare(`SELECT id, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY id`).all();
}

export function getMigrationStatus(db, opts = {}) {
  const files = listMigrationFiles(opts);
  const applied = new Set(getAppliedMigrations(db).map((row) => row.id));
  return files.map((file) => {
    const id = migrationId(file);
    return { id, file, applied: applied.has(id) };
  });
}

/**
 * Apply every not-yet-applied migration, each in its own transaction, in
 * filename order. Safe to call on every connection open — a no-op once the
 * schema is current.
 */
export function runWorkspaceMigrations(db, opts = {}) {
  ensureMigrationsTable(db);
  const applied = new Set(getAppliedMigrations(db).map((row) => row.id));
  const appliedNow = [];

  for (const file of listMigrationFiles(opts)) {
    const id = migrationId(file);
    if (applied.has(id)) continue;
    const body = fs.readFileSync(file, 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(body);
      db.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (id) VALUES (?)`).run(id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    appliedNow.push(id);
  }

  return { applied: appliedNow, status: getMigrationStatus(db, opts) };
}
