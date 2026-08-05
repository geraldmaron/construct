/**
 * kernel/store/open.ts — the one storage substrate. Four Phase 2 consumers
 * ride it: the tracker projection mirror, the work log, the decision inbox, and
 * the coordinator's task rows.
 *
 * It is one substrate on purpose. The predecessor persisted projections through
 * a Dolt lock, which is why the projection harvest stopped at the pure logic and
 * deferred storage: fixing a storage shape before its
 * consumers exist is guessing. All three consumers exist now, so the shape is
 * chosen against all three at once rather than fitted to whichever landed first.
 * The task table arrived later and is additive: schema version
 * 2 adds a table, changes none of the three. Schema version 3
 * adds `implication_feedback`, additive in the same way: a verdict a user
 * renders on the domains a run surfaced (or felt the absence of), append-only
 * like the work log and for the same reason — a corpus whose labels can be
 * quietly edited after the fact is how the last one died. Schema version 4
 * adds the model-consultation cache, additive again: what a
 * model said about an outcome, so the same outcome does not pay for the same
 * call twice across processes. Write-once rather than append-only — it holds
 * one row per outcome, not a history — but guarded by the same reasoning: a
 * record of a model's stated reason that can be quietly rewritten is not
 * evidence, and named implications cite exactly that reason. The table was
 * born `escalation_cache` and became `naming_cache` when the namer turned
 * primary (2026-08-05) — an alpha carries no schema
 * compatibility (STRATEGY preamble), so the rename is a rename, not a
 * migration; a store created before it simply carries an unused table.
 * Schema version 5 adds `lessons` and `workspace_consent`, additive again:
 * the lesson store's scope column is the confidentiality property — a lesson
 * row cannot exist without a workspace, and immutability is a trigger, not a
 * caller convention, because a lesson that can be edited after admission is
 * not evidence of anything. Schema version 6 adds `lesson_admissions`,
 * additive and append-only: an admission verdict that could be quietly
 * replaced would let a held lesson go operational with no record of who let
 * it, so rollback is a newer row, never an edit. Schema version 7 adds
 * `run_dispatch`, write-once: the host and model named at the moment of
 * intent are facts of the run, recorded so a later dispatch cannot silently
 * fall through to whatever the host last used. Schema version 8 adds the
 * grounding surfaces: `sources` (what a workspace has declared it works
 * from — retire-only, never deleted, so a source that informed past runs
 * stays inspectable), `workspace_mode` (team: Construct is the whole team;
 * seat: it fills one role on a human team — a user setting, so an upsert),
 * `source_reads` (append-only provenance: a claim of grounding without a
 * matching read row is a fabrication, and this is the row it must match),
 * `write_proposals` + `proposal_decisions` (outward writes to tickets and
 * trackers exist only as immutable proposals decided by append-only
 * verdicts — applying is a recorded decision, never a side effect), and
 * `write_consent` (standing per-workspace permission for low-risk applies;
 * an absent row is a no, same reasoning as workspace_consent). Schema version
 * 9 adds `plans`, write-once: a run's plan is the recorded understanding it
 * worked from, and a plan that could be rewritten after the work would let
 * the record agree with whatever happened instead of what was intended —
 * replanning is a new run, not an edit.
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
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Paths } from '../paths.ts';

export const SCHEMA_VERSION = 9;

export interface Store {
  readonly db: DatabaseSync;
  readonly path: string;
  close(): void;
}

/**
 * The store could not be opened, and it is the environment's fault rather than
 * a defect: a directory the user cannot write, a full disk, a file written by a
 * newer build. Distinct from a plain Error so the CLI can turn exactly this
 * class into a one-line diagnosis and let every genuine bug keep its stack.
 */
export class StoreUnavailableError extends Error {
  readonly path: string;
  readonly reason: string;

  constructor(path: string, reason: string) {
    super(`cannot open the store at ${path}: ${reason}`);
    this.name = 'StoreUnavailableError';
    this.path = path;
    this.reason = reason;
  }
}

/**
 * A user-facing reason for an errno. Anything unmapped keeps the underlying
 * message: a wrong-but-fluent phrase is worse than the raw truth, and this is
 * the text someone reads when they are already stuck.
 */
const REASONS: Readonly<Record<string, string>> = {
  EACCES: 'permission denied',
  EPERM: 'operation not permitted',
  EROFS: 'the filesystem is read-only',
  ENOSPC: 'no space left on the device',
  ENOTDIR: 'a path component is not a directory',
  EISDIR: 'that path is a directory, not a file',
  ELOOP: 'too many symbolic links in the path',
  ENAMETOOLONG: 'the path is too long',
  EMFILE: 'this process has too many open files',
  ENFILE: 'this system has too many open files',
};

function reasonFor(error: unknown): string {
  const record = error as { code?: unknown; message?: unknown } | null;
  const code = typeof record?.code === 'string' ? record.code : null;
  if (code && REASONS[code]) return REASONS[code];
  const message = typeof record?.message === 'string' ? record.message : String(error);
  return code ? `${code}: ${message}` : message;
}

/**
 * Why the store's directory cannot be written, or null if it can. Non-mutating:
 * `doctor` answers "would this work" without creating a database as a side
 * effect of being asked a question.
 *
 * A directory that does not exist yet is not a problem — `openStore` creates it
 * — so the check walks up to the nearest component that does exist and asks
 * whether that one can be written and traversed.
 *
 * The honest limit: this reads permission bits, not every reason a write can
 * fail. A disk that fills between the probe and the write still fails at first
 * use — with the one-line diagnosis above, not a stack trace.
 */
export function storeWriteProblem(storeFile: string): string | null {
  let dir = dirname(storeFile);
  while (!existsSync(dir)) {
    const parent = dirname(dir);
    if (parent === dir) return `no existing directory to create ${dir} under`;
    dir = parent;
  }

  try {
    accessSync(dir, constants.W_OK | constants.X_OK);
  } catch (error) {
    return `${reasonFor(error)} on ${dir}`;
  }

  // An existing database file can be unreadable while its directory is fine.
  if (existsSync(storeFile)) {
    try {
      accessSync(storeFile, constants.R_OK | constants.W_OK);
    } catch (error) {
      return `${reasonFor(error)} on ${storeFile}`;
    }
  }

  return null;
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

CREATE TABLE IF NOT EXISTS tasks (
  id             TEXT PRIMARY KEY,
  run            TEXT NOT NULL,
  role           TEXT NOT NULL,
  brief          TEXT NOT NULL,
  state          TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  lease_owner    TEXT,
  lease_until    TEXT,
  result         TEXT,
  error          TEXT,
  spend          REAL NOT NULL DEFAULT 0,
  spend_reported INTEGER NOT NULL DEFAULT 0,
  enqueued_at    TEXT NOT NULL,
  settled_at     TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS tasks_run ON tasks (run, enqueued_at, id);
CREATE INDEX IF NOT EXISTS tasks_claimable ON tasks (state, lease_until);

CREATE TABLE IF NOT EXISTS implication_feedback (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  run         TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  verdicts    TEXT NOT NULL,
  source      TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  category    TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS implication_feedback_run ON implication_feedback (run, seq);

CREATE TRIGGER IF NOT EXISTS implication_feedback_no_update
BEFORE UPDATE ON implication_feedback
BEGIN SELECT RAISE(ABORT, 'implication_feedback is append-only'); END;

CREATE TRIGGER IF NOT EXISTS implication_feedback_no_delete
BEFORE DELETE ON implication_feedback
BEGIN SELECT RAISE(ABORT, 'implication_feedback is append-only'); END;

CREATE TABLE IF NOT EXISTS naming_cache (
  outcome      TEXT PRIMARY KEY,
  implications TEXT NOT NULL,
  host         TEXT NOT NULL,
  recorded_at  TEXT NOT NULL
) STRICT;

CREATE TRIGGER IF NOT EXISTS naming_cache_no_update
BEFORE UPDATE ON naming_cache
BEGIN SELECT RAISE(ABORT, 'naming_cache is write-once'); END;

CREATE TABLE IF NOT EXISTS lessons (
  id            TEXT PRIMARY KEY,
  workspace     TEXT NOT NULL,
  scope         TEXT NOT NULL CHECK (scope IN ('workspace', 'global')),
  kind          TEXT NOT NULL,
  body          TEXT NOT NULL,
  citation      TEXT NOT NULL,
  external      INTEGER NOT NULL CHECK (external IN (0, 1)),
  supersedes    TEXT,
  promoted_from TEXT,
  created_at    TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS lessons_workspace ON lessons (workspace, scope, created_at);
CREATE INDEX IF NOT EXISTS lessons_global ON lessons (scope, created_at);

CREATE TRIGGER IF NOT EXISTS lessons_no_update
BEFORE UPDATE ON lessons
BEGIN SELECT RAISE(ABORT, 'lessons are immutable strata'); END;

CREATE TRIGGER IF NOT EXISTS lessons_no_delete
BEFORE DELETE ON lessons
BEGIN SELECT RAISE(ABORT, 'lessons are immutable strata'); END;

CREATE TABLE IF NOT EXISTS workspace_consent (
  workspace       TEXT PRIMARY KEY,
  consumes_global INTEGER NOT NULL CHECK (consumes_global IN (0, 1)),
  recorded_at     TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS lesson_admissions (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson     TEXT NOT NULL,
  verdict    TEXT NOT NULL CHECK (verdict IN ('admitted', 'held')),
  basis      TEXT NOT NULL CHECK (basis IN ('adversarial-pass', 'human-approval')),
  reviewer   TEXT,
  reason     TEXT NOT NULL,
  decided_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS lesson_admissions_lesson ON lesson_admissions (lesson, seq);

CREATE TRIGGER IF NOT EXISTS lesson_admissions_no_update
BEFORE UPDATE ON lesson_admissions
BEGIN SELECT RAISE(ABORT, 'lesson_admissions is append-only'); END;

CREATE TRIGGER IF NOT EXISTS lesson_admissions_no_delete
BEFORE DELETE ON lesson_admissions
BEGIN SELECT RAISE(ABORT, 'lesson_admissions is append-only'); END;

CREATE TABLE IF NOT EXISTS run_dispatch (
  run         TEXT PRIMARY KEY,
  host        TEXT NOT NULL,
  model       TEXT,
  binary      TEXT,
  dir         TEXT,
  recorded_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER IF NOT EXISTS run_dispatch_no_update
BEFORE UPDATE ON run_dispatch
BEGIN SELECT RAISE(ABORT, 'run_dispatch is write-once'); END;

CREATE TABLE IF NOT EXISTS sources (
  id         TEXT PRIMARY KEY,
  workspace  TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('directory', 'git', 'github', 'jira', 'docs')),
  locator    TEXT NOT NULL,
  added_at   TEXT NOT NULL,
  retired_at TEXT
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS sources_active
  ON sources (workspace, kind, locator) WHERE retired_at IS NULL;

CREATE TRIGGER IF NOT EXISTS sources_retire_only
BEFORE UPDATE ON sources
WHEN NEW.id != OLD.id OR NEW.workspace != OLD.workspace OR NEW.kind != OLD.kind
  OR NEW.locator != OLD.locator OR NEW.added_at != OLD.added_at
  OR OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
BEGIN SELECT RAISE(ABORT, 'a source is retired, never edited'); END;

CREATE TRIGGER IF NOT EXISTS sources_no_delete
BEFORE DELETE ON sources
BEGIN SELECT RAISE(ABORT, 'a source is retired, never deleted'); END;

CREATE TABLE IF NOT EXISTS workspace_mode (
  workspace   TEXT PRIMARY KEY,
  mode        TEXT NOT NULL CHECK (mode IN ('team', 'seat')),
  recorded_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS source_reads (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  run         TEXT NOT NULL,
  source      TEXT NOT NULL,
  descriptor  TEXT NOT NULL,
  coverage    TEXT NOT NULL CHECK (coverage IN ('complete', 'partial', 'unreachable')),
  detail      TEXT NOT NULL,
  recorded_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS source_reads_run ON source_reads (run, seq);

CREATE TRIGGER IF NOT EXISTS source_reads_no_update
BEFORE UPDATE ON source_reads
BEGIN SELECT RAISE(ABORT, 'source_reads is append-only'); END;

CREATE TRIGGER IF NOT EXISTS source_reads_no_delete
BEFORE DELETE ON source_reads
BEGIN SELECT RAISE(ABORT, 'source_reads is append-only'); END;

CREATE TABLE IF NOT EXISTS write_proposals (
  id            TEXT PRIMARY KEY,
  workspace     TEXT NOT NULL,
  run           TEXT,
  source        TEXT NOT NULL,
  change        TEXT NOT NULL,
  justification TEXT NOT NULL,
  risk          TEXT NOT NULL CHECK (risk IN ('low', 'high')),
  proposed_at   TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS write_proposals_workspace ON write_proposals (workspace, proposed_at);

CREATE TRIGGER IF NOT EXISTS write_proposals_no_update
BEFORE UPDATE ON write_proposals
BEGIN SELECT RAISE(ABORT, 'a proposal is immutable; its fate is a decision row'); END;

CREATE TRIGGER IF NOT EXISTS write_proposals_no_delete
BEFORE DELETE ON write_proposals
BEGIN SELECT RAISE(ABORT, 'a proposal is immutable; its fate is a decision row'); END;

CREATE TABLE IF NOT EXISTS proposal_decisions (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal   TEXT NOT NULL,
  verdict    TEXT NOT NULL CHECK (verdict IN ('approved', 'rejected', 'applied')),
  basis      TEXT NOT NULL CHECK (basis IN ('human-approval', 'standing-consent')),
  reason     TEXT NOT NULL,
  decided_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS proposal_decisions_proposal ON proposal_decisions (proposal, seq);

CREATE TRIGGER IF NOT EXISTS proposal_decisions_no_update
BEFORE UPDATE ON proposal_decisions
BEGIN SELECT RAISE(ABORT, 'proposal_decisions is append-only'); END;

CREATE TRIGGER IF NOT EXISTS proposal_decisions_no_delete
BEFORE DELETE ON proposal_decisions
BEGIN SELECT RAISE(ABORT, 'proposal_decisions is append-only'); END;

CREATE TABLE IF NOT EXISTS plans (
  id         TEXT PRIMARY KEY,
  run        TEXT NOT NULL UNIQUE,
  plan       TEXT NOT NULL,
  planned_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER IF NOT EXISTS plans_no_update
BEFORE UPDATE ON plans
BEGIN SELECT RAISE(ABORT, 'a plan is write-once; replanning is a new run'); END;

CREATE TRIGGER IF NOT EXISTS plans_no_delete
BEFORE DELETE ON plans
BEGIN SELECT RAISE(ABORT, 'a plan is write-once; replanning is a new run'); END;

CREATE TABLE IF NOT EXISTS write_consent (
  workspace       TEXT PRIMARY KEY,
  allows_low_risk INTEGER NOT NULL CHECK (allows_low_risk IN (0, 1)),
  recorded_at     TEXT NOT NULL
) STRICT;
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
 *
 * Every way this can fail on the environment — an unwritable directory, a full
 * disk, a file that is not a database, a future schema — leaves as a
 * `StoreUnavailableError` carrying the path and a reason. The caller's first
 * contact with a permissions problem should be a sentence, not a stack trace
 * naming node:sqlite.
 */
export function openStore(path: string): Store {
  let db: DatabaseSync;
  try {
    mkdirSync(dirname(path), { recursive: true });
    db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    // Two processes legitimately write this store at once — a coordinator
    // settling tasks while a role's write surface (role-serve) appends in its
    // own name. WAL admits one writer at a time; without a busy timeout the
    // second writer throws SQLITE_BUSY immediately instead of waiting the few
    // milliseconds the first needs to commit.
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec(SCHEMA);
  } catch (error) {
    throw new StoreUnavailableError(path, reasonFor(error));
  }

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
    throw new StoreUnavailableError(
      path,
      `it was written by schema version ${found}, newer than this build understands (${SCHEMA_VERSION})`,
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
