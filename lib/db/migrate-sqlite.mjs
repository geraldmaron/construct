/**
 * lib/db/migrate-sqlite.mjs — SQLite migration runner for node:sqlite-backed
 * stores under lib/db/ (currently the orchestration run store).
 *
 * Mirrors lib/db/migrate.mjs's numbered-file / transactional-apply / applied
 * ledger shape for the embedded backend, synchronously (node:sqlite's
 * DatabaseSync has no async surface) — the same shape
 * lib/graph/relational/migrate-sqlite.mjs already established for the
 * relational graph store. Migrations live under lib/db/migrations/sqlite/, a
 * subdirectory of the Postgres migrations directory that the Postgres runner
 * (lib/db/migrate.mjs's non-recursive readdirSync) never scans, so the two
 * runners coexist in one lib/db/ without either picking up the other's files.
 * A schema change here is always a new numbered file, never an edit to
 * 001_run_store.sql — the inline, unversioned CREATE TABLE this replaces was
 * exactly the anti-pattern the disposition-matrix audit flagged (D5/C2).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SQLITE_MIGRATIONS_DIR = path.join(DB_DIR, 'migrations', 'sqlite');
export const SQLITE_MIGRATIONS_TABLE = 'construct_orchestration_schema_migrations';

function migrationId(filePath) {
  return path.basename(filePath).replace(/\.sql$/i, '');
}

export function listSqliteMigrationFiles({ migrationsDir = SQLITE_MIGRATIONS_DIR } = {}) {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs.readdirSync(migrationsDir)
    .filter((name) => /^\d+_.+\.sql$/i.test(name))
    .sort()
    .map((name) => path.join(migrationsDir, name));
}

export function ensureSqliteMigrationsTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${SQLITE_MIGRATIONS_TABLE} (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
}

export function getAppliedSqliteMigrations(db) {
  ensureSqliteMigrationsTable(db);
  return db.prepare(`SELECT id, applied_at FROM ${SQLITE_MIGRATIONS_TABLE} ORDER BY id`).all();
}

export function getSqliteMigrationStatus(db, opts = {}) {
  const files = listSqliteMigrationFiles(opts);
  const applied = new Set(getAppliedSqliteMigrations(db).map((row) => row.id));
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
export function runSqliteMigrations(db, opts = {}) {
  ensureSqliteMigrationsTable(db);
  const applied = new Set(getAppliedSqliteMigrations(db).map((row) => row.id));
  const appliedNow = [];

  for (const file of listSqliteMigrationFiles(opts)) {
    const id = migrationId(file);
    if (applied.has(id)) continue;
    const body = fs.readFileSync(file, 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(body);
      db.prepare(`INSERT INTO ${SQLITE_MIGRATIONS_TABLE} (id) VALUES (?)`).run(id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    appliedNow.push(id);
  }

  return { applied: appliedNow, status: getSqliteMigrationStatus(db, opts) };
}
