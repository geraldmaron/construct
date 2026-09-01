/**
 * kernel/state/open.ts — open or create a project-local Construct state v1 store.
 *
 * Refuses unrecognized formats and prior alpha schema versions. No migration.
 */

import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  STATE_FORMAT_ID,
  STATE_FORMAT_VERSION,
  UnsupportedAlphaStoreError,
} from './format.ts';
import { SCHEMA_V1_SQL } from './schema.ts';

export interface StateStore {
  readonly db: DatabaseSync;
  readonly path: string;
  close(): void;
}

function readMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function writeMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

/**
 * Detect legacy home/project sqlite that used SCHEMA_VERSION integers without
 * a format id — including schema 23.
 */
function refuseIfLegacy(db: DatabaseSync): void {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all() as Array<{ name: string }>;
  const names = new Set(tables.map((t) => t.name));

  if (!names.has('meta')) {
    // Empty or unrelated file with no meta — treat as unsupported if any tables exist.
    if (names.size > 0) throw new UnsupportedAlphaStoreError(null, null);
    return;
  }

  const format = readMeta(db, 'format');
  const versionRaw = readMeta(db, 'format_version') ?? readMeta(db, 'schema_version');

  if (format === STATE_FORMAT_ID) {
    const version = versionRaw !== null ? Number(versionRaw) : NaN;
    if (version !== STATE_FORMAT_VERSION) {
      throw new UnsupportedAlphaStoreError(format, Number.isFinite(version) ? version : null);
    }
    return;
  }

  // Prior alphas stamped schema_version (1..23) without format id.
  if (format === null && versionRaw !== null) {
    throw new UnsupportedAlphaStoreError(null, Number(versionRaw));
  }
  if (format !== null && format !== STATE_FORMAT_ID) {
    throw new UnsupportedAlphaStoreError(format, versionRaw !== null ? Number(versionRaw) : null);
  }
  // meta exists but empty / unknown — refuse rather than guess.
  if (names.size > 1 || (names.size === 1 && readMeta(db, 'format') === null && versionRaw === null)) {
    // Brand-new create path applies schema then stamps meta; opening a file that
    // already has only empty meta is still unsupported.
    const hasAppTables = [...names].some((n) => n !== 'meta');
    if (hasAppTables) throw new UnsupportedAlphaStoreError(format, null);
  }
}

/**
 * Open an existing v1 store or create a fresh one at `dbPath`.
 */
export function openStateStore(dbPath: string): StateStore {
  mkdirSync(dirname(dbPath), { recursive: true });
  const existed = existsSync(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');

  if (existed) {
    try {
      refuseIfLegacy(db);
    } catch (err) {
      db.close();
      throw err;
    }
    const format = readMeta(db, 'format');
    if (format !== STATE_FORMAT_ID) {
      db.close();
      throw new UnsupportedAlphaStoreError(format, null);
    }
    // Additive v1 tables appear on reopen without a format bump.
    db.exec(SCHEMA_V1_SQL);
    ensureDecisionsShape(db);
  } else {
    db.exec(SCHEMA_V1_SQL);
    writeMeta(db, 'format', STATE_FORMAT_ID);
    writeMeta(db, 'format_version', String(STATE_FORMAT_VERSION));
  }

  return {
    db,
    path: dbPath,
    close: () => db.close(),
  };
}

/**
 * Alpha cutover: early v1 decisions tables lacked subject_json and the
 * judgment kinds (waiver/revocation/verdict/consent). Rebuild in place so
 * reopen works without a format bump — still not a schema-23 migration.
 */
function ensureDecisionsShape(db: DatabaseSync): void {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'decisions'`)
    .get() as { sql: string } | undefined;
  if (!row) return;
  if (row.sql.includes('requires_waiver') && row.sql.includes('subject_json')) return;

  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE decisions_new (
        id              TEXT PRIMARY KEY,
        run_id          TEXT REFERENCES runs(id),
        kind            TEXT NOT NULL CHECK (kind IN (
                          'requires_decision',
                          'requires_action_approval',
                          'requires_trust',
                          'requires_waiver',
                          'requires_revocation',
                          'requires_verdict',
                          'requires_consent',
                          'blocked'
                        )),
        question        TEXT NOT NULL,
        subject_json    TEXT,
        state           TEXT NOT NULL CHECK (state IN ('open', 'resolved')),
        resolution_json TEXT,
        raised_at       TEXT NOT NULL,
        resolved_at     TEXT,
        resolved_by     TEXT
      );
      INSERT INTO decisions_new (
        id, run_id, kind, question, subject_json, state,
        resolution_json, raised_at, resolved_at, resolved_by
      )
      SELECT id, run_id, kind, question, NULL, state,
             resolution_json, raised_at, resolved_at, resolved_by
        FROM decisions;
      DROP TABLE decisions;
      ALTER TABLE decisions_new RENAME TO decisions;
      CREATE INDEX IF NOT EXISTS decisions_open ON decisions (state, raised_at);
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
