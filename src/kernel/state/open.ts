/**
 * kernel/state/open.ts — open or create the project's one state database.
 *
 * Refuses any file that is not exactly this format. Foreign keys are always
 * on. Multi-row transitions run inside `transaction`, which is the only
 * place BEGIN and COMMIT appear.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { STATE_FORMAT_ID, STATE_FORMAT_VERSION, UnsupportedStateError } from './format.ts';
import { REQUIRED_TABLES, SCHEMA_SQL } from './schema.ts';

export interface StateStore {
  readonly db: DatabaseSync;
  readonly path: string;
  /** Run `fn` atomically. Nested calls join the outer transaction. */
  transaction<T>(fn: () => T): T;
  close(): void;
}

function tableNames(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function readMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

/**
 * Anything other than "meta says construct-state, format 2, and every
 * required table exists" is refused. Old stores are recognized only by the
 * absence of that stamp; their contents are never read.
 */
function verifyFormat(db: DatabaseSync): void {
  const names = tableNames(db);
  if (names.size === 0) return; // an empty file: create path stamps it
  if (!names.has('meta')) throw new UnsupportedStateError(null, null);

  const format = readMeta(db, 'format');
  const versionRaw = readMeta(db, 'format_version') ?? readMeta(db, 'schema_version');
  const version = versionRaw === null ? null : Number(versionRaw);
  const versionOrNull = version !== null && Number.isFinite(version) ? version : null;

  if (format !== STATE_FORMAT_ID || versionOrNull !== STATE_FORMAT_VERSION) {
    throw new UnsupportedStateError(format, versionOrNull);
  }
  for (const table of REQUIRED_TABLES) {
    if (!names.has(table)) throw new UnsupportedStateError(format, versionOrNull);
  }
}

export function openStateStore(dbPath: string): StateStore {
  mkdirSync(dirname(dbPath), { recursive: true });
  const existed = existsSync(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');

  try {
    if (existed) {
      verifyFormat(db);
      if (tableNames(db).size === 0) stampFresh(db);
    } else {
      stampFresh(db);
    }
  } catch (err) {
    db.close();
    throw err;
  }

  let depth = 0;
  return {
    db,
    path: dbPath,
    transaction<T>(fn: () => T): T {
      if (depth > 0) return fn();
      depth += 1;
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      } finally {
        depth -= 1;
      }
    },
    close: () => db.close(),
  };
}

function stampFresh(db: DatabaseSync): void {
  db.exec('BEGIN');
  try {
    db.exec(SCHEMA_SQL);
    const put = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    put.run('format', STATE_FORMAT_ID);
    put.run('format_version', String(STATE_FORMAT_VERSION));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
