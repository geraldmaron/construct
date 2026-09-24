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
 * Refuses any file that is not exactly this format. A store in an earlier
 * format is upgraded only when the caller asks for it; a read never changes
 * the file's format. Foreign keys are always on. Multi-row transitions run
 * inside `transaction`, which is the only place BEGIN and COMMIT appear.
 */

import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { STATE_FORMAT_ID, STATE_FORMAT_VERSION, StateBusyError, UnsupportedStateError } from './format.ts';
import { REQUIRED_TABLES, SCHEMA_SQL } from './schema.ts';
import { isCompleteV2, migrateV2ToV3, migrateV3ToV4 } from './migrate.ts';

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
  /** The format this open upgraded from, when it performed an upgrade; otherwise null. */
  readonly migratedFrom: number | null;
  /**
   * Run `fn` atomically. A nested call runs as a savepoint inside the outer
   * transaction: its failure undoes only its own writes and is rethrown.
   */
  transaction<T>(fn: () => T): T;
  close(): void;
}

/**
 * True when a node:sqlite error is SQLITE_BUSY, including its extended codes:
 * another connection holds the lock. SQLITE_LOCKED is a conflict inside this
 * connection and surfaces unchanged.
 */
export function isBusyError(error: unknown): boolean {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  if (typeof code === 'number') return (code & 0xff) === 5;
  return /database is locked/i.test(error instanceof Error ? error.message : String(error));
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
 * Format 4 is current. A complete store in format 2 or 3 is upgraded in place
 * (one way, through each format in turn) when `migrate` is set, and refused as
 * older otherwise. A newer format is refused as newer, never with an
 * instruction that would discard it. Anything else is refused unread.
 */
function verifyFormat(db: DatabaseSync, path: string, options: OpenStateOptions): number | null {
  const names = tableNames(db);
  if (names.size === 0) return null; // an empty file: the create path stamps it
  if (!names.has('meta')) throw new UnsupportedStateError(null, null);

  const format = readMeta(db, 'format');
  const versionRaw = readMeta(db, 'format_version') ?? readMeta(db, 'schema_version');
  const version = versionRaw === null ? null : Number(versionRaw);
  const versionOrNull = version !== null && Number.isFinite(version) ? version : null;

  if (format !== STATE_FORMAT_ID) throw new UnsupportedStateError(format, versionOrNull);
  if (versionOrNull !== null && versionOrNull > STATE_FORMAT_VERSION) {
    throw new UnsupportedStateError(format, versionOrNull, 'newer');
  }
  if (versionOrNull === 2 || versionOrNull === 3) {
    if (versionOrNull === 2 && !isCompleteV2(db)) throw new UnsupportedStateError(format, versionOrNull);
    if (!options.migrate || options.readOnly) throw new UnsupportedStateError(format, versionOrNull, 'older');
    let migrated: number | null = null;
    beginImmediate(db, path);
    try {
      // Another process may have upgraded it while this one waited for the lock.
      const found = Number(readMeta(db, 'format_version'));
      if (found === 2) migrateV2ToV3(db);
      if (found === 2 || found === 3) {
        migrateV3ToV4(db);
        migrated = found;
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    for (const table of REQUIRED_TABLES) {
      if (!tableNames(db).has(table)) throw new UnsupportedStateError(format, STATE_FORMAT_VERSION);
    }
    return migrated;
  } else if (versionOrNull !== STATE_FORMAT_VERSION) {
    throw new UnsupportedStateError(format, versionOrNull);
  }
  for (const table of REQUIRED_TABLES) {
    if (!tableNames(db).has(table)) throw new UnsupportedStateError(format, STATE_FORMAT_VERSION);
  }
  return null;
}

/** How long each WAL switch attempt waits for the lock; a longer hold leaves the switch to a later open. */
const WAL_SWITCH_WAIT_MS = 200;

/**
 * Switch to WAL, waiting only briefly for the exclusive access the switch
 * needs. A mode other than WAL without a busy error is the filesystem refusing
 * WAL, which a retry cannot change. Returns the mode in effect; WAL persists in
 * the file, so a switch that could not happen now happens on a later open.
 */
function enableWal(db: DatabaseSync, busyTimeoutMs: number): string {
  let mode = 'delete';
  db.exec(`PRAGMA busy_timeout = ${WAL_SWITCH_WAIT_MS}`);
  try {
    for (let attempt = 0; attempt < BEGIN_ATTEMPTS; attempt += 1) {
      try {
        const row = db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode?: string } | undefined;
        mode = String(row?.journal_mode ?? mode).toLowerCase();
        return mode;
      } catch (error) {
        if (!isBusyError(error)) throw error;
      }
      pause(jitter(attempt));
    }
    return mode;
  } finally {
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
  }
}

/** Whether a transaction is open on this connection; null when this Node cannot say. */
function inTransaction(db: DatabaseSync): boolean | null {
  const live = (db as { isTransaction?: unknown }).isTransaction;
  return typeof live === 'boolean' ? live : null;
}

function currentJournalMode(db: DatabaseSync): string {
  const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode?: string } | undefined;
  return String(row?.journal_mode ?? 'delete').toLowerCase();
}

/** The format a write transaction may commit into; anything else was written by another build meanwhile. */
function assertCurrentFormat(db: DatabaseSync): void {
  const version = Number(readMeta(db, 'format_version'));
  if (version === STATE_FORMAT_VERSION) return;
  throw new UnsupportedStateError(readMeta(db, 'format'), Number.isFinite(version) ? version : null, version > STATE_FORMAT_VERSION ? 'newer' : 'foreign');
}

export function openStateStore(dbPath: string, options: OpenStateOptions = {}): StateStore {
  const readOnly = options.readOnly === true;
  const busyTimeoutMs = Math.max(0, Math.floor(options.busyTimeoutMs ?? BUSY_TIMEOUT_MS));
  if (readOnly && !existsSync(dbPath)) throw new Error(`no state database at ${dbPath}`);
  if (!readOnly) mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath, { readOnly });
  let journalMode = 'delete';
  let migratedFrom: number | null = null;
  try {
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
    db.exec('PRAGMA foreign_keys = ON');
    if (tableNames(db).size === 0) {
      // Another process may be creating this store right now; a reader waits for it.
      if (readOnly) throw new StateBusyError(dbPath);
      journalMode = enableWal(db, busyTimeoutMs);
      stampFresh(db, dbPath);
    }
    // The format is settled before anything about the file changes, so a store
    // this build refuses is left exactly as it was found.
    migratedFrom = verifyFormat(db, dbPath, options);
    if (!readOnly) {
      narrow(dirname(dbPath), 0o700);
      narrow(dbPath, 0o600);
      journalMode = currentJournalMode(db) === 'wal' ? 'wal' : enableWal(db, busyTimeoutMs);
      db.exec('PRAGMA synchronous = NORMAL');
    } else {
      journalMode = currentJournalMode(db);
    }
  } catch (err) {
    db.close();
    if (isBusyError(err)) throw new StateBusyError(dbPath);
    throw err;
  }

  let depth = 0;
  /** Set when SQLite itself ended the transaction inside a nested call; the whole outer call then fails. */
  let aborted: unknown = null;
  return {
    db,
    path: dbPath,
    journalMode,
    readOnly,
    migratedFrom,
    transaction<T>(fn: () => T): T {
      if (depth > 0) {
        if (aborted !== null) throw aborted;
        const savepoint = `nested_${depth}`;
        db.exec(`SAVEPOINT ${savepoint}`);
        depth += 1;
        try {
          const out = fn();
          db.exec(`RELEASE ${savepoint}`);
          return out;
        } catch (err) {
          const live = inTransaction(db);
          let undone = false;
          if (live !== false) {
            try {
              db.exec(`ROLLBACK TO ${savepoint}`);
              db.exec(`RELEASE ${savepoint}`);
              undone = true;
            } catch {
              // SQLite already ended the whole transaction; the outer call must fail.
            }
          }
          if (!undone && aborted === null) {
            aborted = err;
            // Anything the outer call runs from here on joins this stand-in
            // transaction and is rolled back with it, instead of committing
            // one statement at a time.
            try {
              db.exec('BEGIN');
            } catch {
              // A transaction is somehow still open; the outer call rolls it back.
            }
          }
          throw err;
        } finally {
          depth -= 1;
        }
      }
      beginImmediate(db, dbPath);
      depth = 1;
      aborted = null;
      try {
        assertCurrentFormat(db);
        const out = fn();
        if (aborted !== null) throw aborted;
        db.exec('COMMIT');
        return out;
      } catch (err) {
        if (inTransaction(db) !== false) {
          try {
            db.exec('ROLLBACK');
          } catch {
            // Nothing left to undo.
          }
        }
        if (isBusyError(err)) throw new StateBusyError(dbPath);
        throw err;
      } finally {
        depth = 0;
        aborted = null;
      }
    },
    close: () => db.close(),
  };
}

/**
 * Stamp an empty file in the current format under the write lock. Another process may
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
