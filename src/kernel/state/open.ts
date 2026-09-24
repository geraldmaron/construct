/**
 * kernel/state/open.ts — open or create the project's one state database.
 *
 * Several processes open the same file at once: every host session runs its
 * own MCP server, and the command line runs beside them. So the database runs
 * in WAL mode where the filesystem allows it, every connection waits up to
 * five seconds for a lock instead of failing at once, and a write transaction
 * that cannot begin is retried before it is reported busy. A failed begin
 * leaves the connection exactly as it was, so the next transaction is still a
 * transaction.
 *
 * Refuses any file that is not exactly this format. A store in the previous
 * format is upgraded only when the caller asks for it; a read never changes
 * the file's format. Foreign keys are always on. Multi-row transitions run
 * inside `transaction`, which is the only place BEGIN and COMMIT appear.
 */

import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { STATE_FORMAT_ID, STATE_FORMAT_VERSION, StateBusyError, UnsupportedStateError } from './format.ts';
import { REQUIRED_TABLES, SCHEMA_SQL } from './schema.ts';
import { isCompleteV2, migrateV2ToV3 } from './migrate.ts';

/** How long one statement waits for another connection's lock. */
export const BUSY_TIMEOUT_MS = 5000;
/** Extra attempts to begin a write transaction after the busy timeout expires. */
const BEGIN_ATTEMPTS = 3;

export interface OpenStateOptions {
  /** Open without write access. Never creates, stamps, or migrates. */
  readonly readOnly?: boolean;
  /** Upgrade a complete store in the previous format. Only `construct migrate` asks. */
  readonly migrate?: boolean;
  /** Per-statement lock wait. Defaults to BUSY_TIMEOUT_MS; tests shorten it. */
  readonly busyTimeoutMs?: number;
}

export interface StateStore {
  readonly db: DatabaseSync;
  readonly path: string;
  /** `wal` when the filesystem allowed it; otherwise the rollback journal mode in use. */
  readonly journalMode: string;
  readonly readOnly: boolean;
  /**
   * Run `fn` atomically. A nested call runs as a savepoint inside the outer
   * transaction: its failure undoes only its own writes and is rethrown.
   */
  transaction<T>(fn: () => T): T;
  close(): void;
}

/** True when a node:sqlite error is SQLITE_BUSY or SQLITE_LOCKED, including extended codes. */
export function isBusyError(error: unknown): boolean {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  if (typeof code === 'number') {
    const primary = code & 0xff;
    return primary === 5 || primary === 6;
  }
  return /database (?:table )?is locked/i.test(error instanceof Error ? error.message : String(error));
}

/** State holds decisions, grants, and source content: owner-only. A file this user does not own is left alone. */
function narrow(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Not ours to change; the open itself still succeeds or fails on its own terms.
  }
}

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function jitter(attempt: number): number {
  return 50 * 2 ** attempt + Math.floor(Math.random() * 50);
}

/** BEGIN IMMEDIATE, retried with backoff when another writer holds the lock past the busy timeout. */
function beginImmediate(db: DatabaseSync, path: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      db.exec('BEGIN IMMEDIATE');
      return;
    } catch (error) {
      if (!isBusyError(error)) throw error;
      if (attempt + 1 >= BEGIN_ATTEMPTS) throw new StateBusyError(path);
      pause(jitter(attempt));
    }
  }
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
 * Format 3 is current. A complete format-2 store is upgraded in place (one
 * way) when `migrate` is set, and refused as older otherwise. A newer format
 * is refused as newer, never with an instruction that would discard it.
 * Anything else is refused unread.
 */
function verifyFormat(db: DatabaseSync, path: string, options: OpenStateOptions): void {
  const names = tableNames(db);
  if (names.size === 0) return; // an empty file: the create path stamps it
  if (!names.has('meta')) throw new UnsupportedStateError(null, null);

  const format = readMeta(db, 'format');
  const versionRaw = readMeta(db, 'format_version') ?? readMeta(db, 'schema_version');
  const version = versionRaw === null ? null : Number(versionRaw);
  const versionOrNull = version !== null && Number.isFinite(version) ? version : null;

  if (format !== STATE_FORMAT_ID) throw new UnsupportedStateError(format, versionOrNull);
  if (versionOrNull !== null && versionOrNull > STATE_FORMAT_VERSION) {
    throw new UnsupportedStateError(format, versionOrNull, 'newer');
  }
  if (versionOrNull === 2) {
    if (!isCompleteV2(db)) throw new UnsupportedStateError(format, versionOrNull);
    if (!options.migrate || options.readOnly) throw new UnsupportedStateError(format, versionOrNull, 'older');
    beginImmediate(db, path);
    try {
      if (readMeta(db, 'format_version') === '2') migrateV2ToV3(db);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } else if (versionOrNull !== STATE_FORMAT_VERSION) {
    throw new UnsupportedStateError(format, versionOrNull);
  }
  for (const table of REQUIRED_TABLES) {
    if (!tableNames(db).has(table)) throw new UnsupportedStateError(format, STATE_FORMAT_VERSION);
  }
}

/** Switch to WAL, retrying while another connection holds the lock. Returns the mode in effect. */
function enableWal(db: DatabaseSync): string {
  let mode = 'delete';
  for (let attempt = 0; attempt < BEGIN_ATTEMPTS; attempt += 1) {
    try {
      const row = db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode?: string } | undefined;
      mode = String(row?.journal_mode ?? mode).toLowerCase();
      if (mode === 'wal') return mode;
    } catch (error) {
      if (!isBusyError(error)) throw error;
    }
    pause(jitter(attempt));
  }
  return mode;
}

export function openStateStore(dbPath: string, options: OpenStateOptions = {}): StateStore {
  const readOnly = options.readOnly === true;
  const existed = existsSync(dbPath);
  if (readOnly && !existed) throw new UnsupportedStateError(null, null);
  if (!readOnly) {
    const dir = dirname(dbPath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    narrow(dir, 0o700);
  }
  const db = new DatabaseSync(dbPath, { readOnly });
  let journalMode = 'delete';
  try {
    db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(options.busyTimeoutMs ?? BUSY_TIMEOUT_MS))}`);
    db.exec('PRAGMA foreign_keys = ON');
    if (!readOnly) {
      narrow(dbPath, 0o600);
      journalMode = enableWal(db);
      db.exec('PRAGMA synchronous = NORMAL');
    } else {
      const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode?: string } | undefined;
      journalMode = String(row?.journal_mode ?? journalMode).toLowerCase();
    }
    if (tableNames(db).size === 0) {
      if (readOnly) throw new UnsupportedStateError(null, null);
      stampFresh(db, dbPath);
    }
    verifyFormat(db, dbPath, options);
  } catch (err) {
    db.close();
    if (isBusyError(err)) throw new StateBusyError(dbPath);
    throw err;
  }

  let depth = 0;
  return {
    db,
    path: dbPath,
    journalMode,
    readOnly,
    transaction<T>(fn: () => T): T {
      if (depth > 0) {
        const savepoint = `nested_${depth}`;
        db.exec(`SAVEPOINT ${savepoint}`);
        depth += 1;
        try {
          const out = fn();
          db.exec(`RELEASE ${savepoint}`);
          return out;
        } catch (err) {
          db.exec(`ROLLBACK TO ${savepoint}`);
          db.exec(`RELEASE ${savepoint}`);
          throw err;
        } finally {
          depth -= 1;
        }
      }
      beginImmediate(db, dbPath);
      depth = 1;
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // COMMIT or fn already ended the transaction; nothing to undo.
        }
        if (isBusyError(err)) throw new StateBusyError(dbPath);
        throw err;
      } finally {
        depth = 0;
      }
    },
    close: () => db.close(),
  };
}

/**
 * Stamp an empty file as format 3 under the write lock. Another process may
 * have stamped it between the emptiness check and the lock; the check is
 * repeated inside the transaction so the second opener only verifies.
 */
function stampFresh(db: DatabaseSync, path: string): void {
  beginImmediate(db, path);
  try {
    if (tableNames(db).size === 0) {
      db.exec(SCHEMA_SQL);
      const put = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
      put.run('format', STATE_FORMAT_ID);
      put.run('format_version', String(STATE_FORMAT_VERSION));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
