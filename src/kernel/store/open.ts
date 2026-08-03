/**
 * kernel/store/open.ts — the one storage substrate. Three Phase 2 consumers
 * ride it: the tracker projection mirror, the work log, and the decision inbox.
 *
 * It is one substrate on purpose. The predecessor persisted projections through
 * a Dolt lock, which is why the projection harvest stopped at the pure logic and
 * deferred storage (see construct-v3j): fixing a storage shape before its
 * consumers exist is guessing. All three consumers exist now, so the shape is
 * chosen against all three at once rather than fitted to whichever landed first.
 *
 * SQLite via `node:sqlite`, which ships with Node — no dependency is added to a
 * CLI users install. STRATEGY ("What carries over") commits the tracker model to
 * "a new SQLite-backed substrate rather than the predecessor's dolt-locked one".
 *
 * Two disciplines this module inherits from the rest of the kernel and enforces
 * rather than documents:
 *
 *   - The kernel never reads the clock. Every timestamp is a caller-supplied
 *     argument. There is no `new Date()` anywhere under src/kernel/store.
 *   - The kernel never reads the environment. `openStore` takes a path; callers
 *     get theirs from an injected `Paths` (kernel/paths.ts is the only module
 *     permitted to read env or homedir).
 *
 * Note: `node:sqlite` emits an ExperimentalWarning on Node 22.x. It is stable
 * enough to depend on — the API used here (DatabaseSync, exec, prepare) has not
 * changed since 22.5 — but the warning is expected output, not a defect.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Paths } from '../paths.ts';

export const SCHEMA_VERSION = 1;

export interface Store {
  readonly db: DatabaseSync;
  readonly path: string;
  close(): void;
}

/**
 * The work log is append-only, and that is enforced by the database rather than
 * by the callers' good intentions. Commitment 14 exists because a role under
 * completion pressure rewrote its own status in the predecessor; commitment 15
 * makes the log load-bearing for trust. A guarantee that depends on every future
 * caller remembering it is not a guarantee, so UPDATE and DELETE on work_log
 * raise at the storage layer.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS projections (
  id              TEXT PRIMARY KEY,
  workspace       TEXT,
  work            TEXT,
  tracker         TEXT NOT NULL,
  external_id     TEXT NOT NULL,
  state           TEXT NOT NULL,
  field_authority TEXT NOT NULL,
  fields          TEXT NOT NULL,
  raw_record      TEXT NOT NULL,
  imported_at     TEXT,
  reconciled_at   TEXT
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS projections_tracker_external
  ON projections (tracker, external_id);

CREATE TABLE IF NOT EXISTS work_log (
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  run     TEXT NOT NULL,
  task    TEXT,
  role    TEXT NOT NULL,
  action  TEXT NOT NULL,
  detail  TEXT NOT NULL,
  at      TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS work_log_run ON work_log (run, seq);

CREATE TRIGGER IF NOT EXISTS work_log_no_update
BEFORE UPDATE ON work_log
BEGIN SELECT RAISE(ABORT, 'work_log is append-only'); END;

CREATE TRIGGER IF NOT EXISTS work_log_no_delete
BEFORE DELETE ON work_log
BEGIN SELECT RAISE(ABORT, 'work_log is append-only'); END;

CREATE TABLE IF NOT EXISTS decisions (
  id          TEXT PRIMARY KEY,
  run         TEXT NOT NULL,
  state       TEXT NOT NULL,
  question    TEXT NOT NULL,
  positions   TEXT NOT NULL,
  raised_at   TEXT NOT NULL,
  resolved_at TEXT,
  resolution  TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS decisions_open ON decisions (state, raised_at);
`;

/** The substrate's file under an injected Paths. Callers do not build this path. */
export function storePath(paths: Paths): string {
  return join(paths.dataDir, 'construct.db');
}

/**
 * Open (creating if absent) the store at `path` and bring its schema up. Safe to
 * call repeatedly on the same file: the schema is idempotent and the version row
 * is written once.
 *
 * Refuses to open a file written by a newer schema than this build understands.
 * Silently operating on a future schema is how a downgrade corrupts data.
 */
export function openStore(path: string): Store {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);

  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as
    | { value: string }
    | undefined;
  const found = row ? Number(row.value) : null;
  if (found === null) {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(
      'schema_version',
      String(SCHEMA_VERSION),
    );
  } else if (found > SCHEMA_VERSION) {
    db.close();
    throw new Error(
      `store at ${path} has schema version ${found}, newer than this build understands (${SCHEMA_VERSION})`,
    );
  }

  return {
    db,
    path,
    close: () => db.close(),
  };
}

/** Run `fn` in a transaction, rolling back if it throws. */
export function transact<T>(store: Store, fn: () => T): T {
  store.db.exec('BEGIN');
  try {
    const result = fn();
    store.db.exec('COMMIT');
    return result;
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
}
