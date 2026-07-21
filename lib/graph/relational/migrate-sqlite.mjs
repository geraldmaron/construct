/**
 * lib/graph/relational/migrate-sqlite.mjs — SQLite migration runner for the
 * relational graph store.
 *
 * Mirrors lib/db/migrate.mjs's numbered-file / transactional-apply / applied
 * ledger shape for the embedded backend, synchronously (node:sqlite's
 * DatabaseSync has no async surface). The SQLite run store's inline
 * unversioned schema is the exact anti-pattern this avoids (design doc §3,
 * audit finding D5) — every schema change here is a new numbered file, never
 * an edit to 001_graph_foundation.sql.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(DIR, 'migrations');
export const MIGRATIONS_TABLE = 'construct_graph_schema_migrations';

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
export function runSqliteMigrations(db, opts = {}) {
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
