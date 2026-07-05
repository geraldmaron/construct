/**
 * lib/db/migrate.mjs — Postgres migration runner.
 *
 * The runner only operates when a SQL client is explicitly configured. Migration
 * files are repo-owned SQL, so sql.unsafe is limited to this static directory.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(DB_DIR, 'migrations');
export const MIGRATIONS_TABLE = 'construct_schema_migrations';

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

export async function ensureMigrationsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS construct_schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

export async function getAppliedMigrations(sql) {
  await ensureMigrationsTable(sql);
  const rows = await sql`SELECT id, applied_at FROM construct_schema_migrations ORDER BY id`;
  return rows.map((row) => ({ id: row.id, appliedAt: row.applied_at }));
}

export async function getMigrationStatus(sql, opts = {}) {
  const files = listMigrationFiles(opts);
  const applied = new Set((await getAppliedMigrations(sql)).map((row) => row.id));
  return files.map((file) => {
    const id = migrationId(file);
    return { id, file, applied: applied.has(id) };
  });
}

export async function applyMigrations(sql, opts = {}) {
  await ensureMigrationsTable(sql);
  const applied = new Set((await getAppliedMigrations(sql)).map((row) => row.id));
  const appliedNow = [];

  for (const file of listMigrationFiles(opts)) {
    const id = migrationId(file);
    if (applied.has(id)) continue;
    const body = fs.readFileSync(file, 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO construct_schema_migrations (id) VALUES (${id})`;
    });
    appliedNow.push(id);
  }

  return { applied: appliedNow, status: await getMigrationStatus(sql, opts) };
}
