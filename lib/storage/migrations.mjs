/**
 * lib/storage/migrations.mjs — Postgres migration runner with hash tracking.
 *
 * Walks `db/schema/*.sql` in lexical order and applies any not yet
 * recorded in `construct_schema_migrations`. Each applied file's SHA256 is
 * stored alongside the filename. Re-running the runner against an unchanged
 * tree is a no-op.
 *
 * Drift detection: if a previously-applied file's SHA changes between runs,
 * the runner fails fast with a precise error. SQL files are append-only by
 * convention — to evolve schema after a migration ships, write a new file
 * with a higher sequence number.
 *
 * The bookkeeping table (`construct_schema_migrations`) is bootstrapped by
 * The bookkeeping table is created inline before applied state is checked,
 * so the runner self-bootstraps and a fresh database can run from any
 * starting migration without a prerequisite file.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = join(MODULE_DIR, '..', '..', 'db', 'schema');

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function listMigrationFiles(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

const BOOKKEEPING_DDL = `
CREATE TABLE IF NOT EXISTS construct_schema_migrations (
    filename TEXT PRIMARY KEY,
    sha TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

/**
 * Apply pending migrations. Returns a per-file outcome summary.
 *
 * @param {object} client — postgres client (from createSqlClient)
 * @param {object} [opts]
 * @param {string} [opts.dir] — schema/migrations directory, defaults to db/schema
 * @returns {Promise<{ applied: string[], skipped: string[], drift: Array<{ filename: string, expected: string, actual: string }> }>}
 */
export async function runMigrations(client, { dir = DEFAULT_MIGRATIONS_DIR } = {}) {
  if (!client) throw new Error('runMigrations requires a postgres client');

  await client.unsafe(BOOKKEEPING_DDL);

  const recorded = await client`
    SELECT filename, sha FROM construct_schema_migrations
  `;
  const recordedMap = new Map(recorded.map((r) => [r.filename, r.sha]));

  const files = listMigrationFiles(dir);
  const applied = [];
  const skipped = [];
  const drift = [];

  for (const filename of files) {
    const path = join(dir, filename);
    const contents = readFileSync(path, 'utf8');
    const sha = sha256(contents);

    const prev = recordedMap.get(filename);
    if (prev) {
      if (prev !== sha) {
        drift.push({ filename, expected: prev, actual: sha });
      } else {
        skipped.push(filename);
      }
      continue;
    }

    await client.begin(async (tx) => {
      await tx.unsafe(contents);
      await tx`
        INSERT INTO construct_schema_migrations (filename, sha)
        VALUES (${filename}, ${sha})
        ON CONFLICT (filename) DO UPDATE SET sha = EXCLUDED.sha, applied_at = now()
      `;
    });
    applied.push(filename);
  }

  if (drift.length > 0) {
    const detail = drift
      .map((d) => `  ${d.filename}: applied SHA ${d.expected.slice(0, 12)}…, on-disk SHA ${d.actual.slice(0, 12)}…`)
      .join('\n');
    throw new Error(
      `Migration drift detected (a previously-applied migration file has changed). ` +
      `Migrations are append-only — write a new file with a higher sequence number ` +
      `to evolve the schema. Drift:\n${detail}`
    );
  }

  return { applied, skipped, drift };
}

/**
 * Diagnostic for `construct doctor`: returns last applied filename, count,
 * and any drift, without throwing.
 */
export async function describeMigrations(client, { dir = DEFAULT_MIGRATIONS_DIR } = {}) {
  if (!client) return { ok: false, reason: 'no_sql_client' };
  try {
    await client.unsafe(BOOKKEEPING_DDL);
    const rows = await client`
      SELECT filename, sha, applied_at
        FROM construct_schema_migrations
       ORDER BY applied_at DESC, filename DESC
       LIMIT 1
    `;
    const onDisk = listMigrationFiles(dir);
    const applied = await client`SELECT count(*)::int AS n FROM construct_schema_migrations`;
    const recorded = await client`SELECT filename, sha FROM construct_schema_migrations`;
    const recordedMap = new Map(recorded.map((r) => [r.filename, r.sha]));
    const drift = [];
    for (const filename of onDisk) {
      const sha = sha256(readFileSync(join(dir, filename), 'utf8'));
      const prev = recordedMap.get(filename);
      if (prev && prev !== sha) drift.push(filename);
    }
    return {
      ok: true,
      lastApplied: rows[0]?.filename || null,
      lastAppliedAt: rows[0]?.applied_at || null,
      appliedCount: applied[0]?.n ?? 0,
      onDiskCount: onDisk.length,
      drift,
    };
  } catch (err) {
    return { ok: false, reason: err?.message || 'describe-migrations failed' };
  }
}
