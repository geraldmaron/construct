/**
 * kernel/state/migrate.ts — one-way upgrades: construct-state 2 to 3
 * (the native work ledger and provenance columns) and 3 to 4 (sessions, agent
 * attribution, fenced claims, path leases, and answer channels), then 4 to 5
 * (trigger-scoped occurrence uniqueness).
 *
 * Format 1 and anything else remain refused unread. A format-2, format-3 or format-4
 * store missing one of its format's tables is also refused unread: these
 * upgrades add to a complete store, they do not repair a truncated one.
 * After native writes begin, rolling back to an older snapshot would drop
 * them; that is why each upgrade is one-way.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const V2_REQUIRED_TABLES = [
  'meta',
  'project_profile',
  'statements',
  'sources',
  'source_authority',
  'source_snapshots',
  'entities',
  'relations',
  'claims',
  'staff_members',
  'staff_capabilities',
  'staff_skills',
  'resolved_skills',
  'resolved_workflows',
  'workflow_runs',
  'step_runs',
  'step_attempts',
  'deliverables',
  'decisions',
  'grants',
  'observations',
  'drift_findings',
  'lessons',
  'triggers',
  'trigger_firings',
  'activity_events',
] as const;

/** Every table a complete format-3 store holds: format 2's and the native work ledger's. */
export const V3_REQUIRED_TABLES = [
  ...V2_REQUIRED_TABLES,
  'work_items',
  'work_dependencies',
  'work_events',
  'work_legacy_ids',
  'work_runs',
  'reviews',
  'run_bindings',
] as const;

const WORK_SQL = `
CREATE TABLE IF NOT EXISTS work_items (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('outcome', 'task', 'defect', 'plan')),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN (
                    'proposed', 'open', 'ready', 'claimed', 'in_progress', 'blocked',
                    'completed', 'cancelled', 'superseded', 'historical'
                  )),
  scope_json      TEXT,
  premises_json   TEXT,
  acceptance_json TEXT,
  risk_json       TEXT,
  entity_id       TEXT REFERENCES entities(id),
  parent_id       TEXT REFERENCES work_items(id),
  superseded_by   TEXT REFERENCES work_items(id),
  revision        INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  claim_owner     TEXT,
  claim_token     TEXT,
  claim_until     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  completed_at    TEXT,
  reason          TEXT
);
CREATE INDEX IF NOT EXISTS work_items_status ON work_items (status, updated_at);
CREATE INDEX IF NOT EXISTS work_items_parent ON work_items (parent_id);

CREATE TABLE IF NOT EXISTS work_dependencies (
  id          TEXT PRIMARY KEY,
  from_id     TEXT NOT NULL REFERENCES work_items(id),
  to_id       TEXT NOT NULL REFERENCES work_items(id),
  kind        TEXT NOT NULL CHECK (kind IN ('blocks', 'informs')),
  created_at  TEXT NOT NULL,
  CHECK (from_id <> to_id),
  UNIQUE (kind, from_id, to_id)
);
CREATE INDEX IF NOT EXISTS work_deps_from ON work_dependencies (from_id, kind);
CREATE INDEX IF NOT EXISTS work_deps_to ON work_dependencies (to_id, kind);

CREATE TABLE IF NOT EXISTS work_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id            TEXT NOT NULL REFERENCES work_items(id),
  at                 TEXT NOT NULL,
  kind               TEXT NOT NULL,
  actor              TEXT,
  expected_revision  INTEGER,
  payload_json       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS work_events_work ON work_events (work_id, id);
CREATE TRIGGER IF NOT EXISTS work_events_no_update BEFORE UPDATE ON work_events
BEGIN
  SELECT RAISE(ABORT, 'work_events is append-only');
END;
CREATE TRIGGER IF NOT EXISTS work_events_no_delete BEFORE DELETE ON work_events
BEGIN
  SELECT RAISE(ABORT, 'work_events is append-only');
END;

CREATE TABLE IF NOT EXISTS work_legacy_ids (
  legacy_id   TEXT PRIMARY KEY,
  work_id     TEXT NOT NULL REFERENCES work_items(id),
  source      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS work_legacy_work ON work_legacy_ids (work_id);

CREATE TABLE IF NOT EXISTS work_runs (
  work_id     TEXT NOT NULL REFERENCES work_items(id),
  run_id      TEXT NOT NULL REFERENCES workflow_runs(id),
  role        TEXT NOT NULL CHECK (role IN ('implements', 'verifies', 'reviews')),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (work_id, run_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id               TEXT PRIMARY KEY,
  subject_kind     TEXT NOT NULL CHECK (subject_kind IN ('deliverable', 'work_item', 'artifact', 'claim', 'run')),
  subject_id       TEXT NOT NULL,
  subject_revision TEXT NOT NULL,
  method           TEXT NOT NULL,
  reviewer         TEXT NOT NULL,
  evidence_json    TEXT NOT NULL,
  objections_json  TEXT NOT NULL,
  dispositions_json TEXT NOT NULL,
  unresolved_json  TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'invalidated')),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reviews_subject ON reviews (subject_kind, subject_id, status);

CREATE TABLE IF NOT EXISTS run_bindings (
  run_id             TEXT PRIMARY KEY REFERENCES workflow_runs(id),
  workflow_id        TEXT NOT NULL,
  workflow_version   TEXT NOT NULL,
  workflow_digest    TEXT NOT NULL,
  skill_bindings_json TEXT NOT NULL,
  policy_digest      TEXT,
  frozen_at          TEXT NOT NULL
);
`;

function tableNames(db: DatabaseSync): Set<string> {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function columnsOf(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function addColumn(db: DatabaseSync, table: string, name: string, decl: string): void {
  if (columnsOf(db, table).has(name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`);
}

export function isCompleteV2(db: DatabaseSync): boolean {
  const names = tableNames(db);
  return V2_REQUIRED_TABLES.every((t) => names.has(t));
}

export function isCompleteV3(db: DatabaseSync): boolean {
  const names = tableNames(db);
  return V3_REQUIRED_TABLES.every((t) => names.has(t));
}

export function migrateV2ToV3(db: DatabaseSync): void {
  addColumn(db, 'statements', 'locator', 'TEXT');
  addColumn(db, 'statements', 'span_json', 'TEXT');
  addColumn(db, 'statements', 'excerpt', 'TEXT');
  addColumn(db, 'statements', 'source_revision', 'TEXT');
  addColumn(db, 'statements', 'extractor_version', 'TEXT');
  addColumn(db, 'statements', 'content_digest', 'TEXT');
  addColumn(db, 'statements', 'coverage_json', 'TEXT');
  addColumn(db, 'statements', 'quoted', 'INTEGER NOT NULL DEFAULT 0 CHECK (quoted IN (0, 1))');

  addColumn(db, 'claims', 'locator', 'TEXT');
  addColumn(db, 'claims', 'span_json', 'TEXT');
  addColumn(db, 'claims', 'excerpt', 'TEXT');
  addColumn(db, 'claims', 'source_revision', 'TEXT');
  addColumn(db, 'claims', 'extractor_version', 'TEXT');
  addColumn(db, 'claims', 'content_digest', 'TEXT');
  addColumn(db, 'claims', 'valid_at', 'TEXT');

  addColumn(db, 'source_snapshots', 'inventory_digest', 'TEXT');
  addColumn(db, 'source_snapshots', 'content_digest', 'TEXT');
  addColumn(db, 'source_snapshots', 'item_count', 'INTEGER');
  addColumn(db, 'source_snapshots', 'coverage_json', 'TEXT');

  addColumn(db, 'workflow_runs', 'invocation_id', 'TEXT');
  addColumn(db, 'workflow_runs', 'work_identity', 'TEXT');
  addColumn(db, 'workflow_runs', 'work_id', 'TEXT');
  addColumn(db, 'workflow_runs', 'workflow_digest', 'TEXT');
  addColumn(db, 'workflow_runs', 'bindings_json', 'TEXT');
  addColumn(db, 'workflow_runs', 'cancel_requested', 'INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1))');

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_invocation ON workflow_runs (invocation_id) WHERE invocation_id IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS workflow_runs_work_identity ON workflow_runs (work_identity, state)');

  db.exec(WORK_SQL);
  db.prepare(`UPDATE meta SET value = '3' WHERE key = 'format_version'`).run();
}

const FORMAT4_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id                  TEXT PRIMARY KEY,
  host                TEXT NOT NULL,
  surface             TEXT NOT NULL CHECK (surface IN ('interactive', 'headless', 'cli', 'hook')),
  host_session_id     TEXT,
  host_session_source TEXT,
  client_name         TEXT,
  client_version      TEXT,
  model               TEXT,
  model_source        TEXT,
  machine             TEXT NOT NULL,
  pid                 INTEGER,
  serve_version       TEXT,
  lane_root           TEXT,
  branch              TEXT,
  head                TEXT,
  started_at          TEXT NOT NULL,
  last_seen_at        TEXT NOT NULL,
  ended_at            TEXT,
  end_reason          TEXT,
  activity_cursor     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sessions_live ON sessions (ended_at, last_seen_at);
CREATE TABLE IF NOT EXISTS session_agents (
  session_id      TEXT NOT NULL REFERENCES sessions(id),
  agent           TEXT NOT NULL,
  host_agent_id   TEXT,
  agent_type      TEXT,
  parent_agent    TEXT,
  attestation     TEXT NOT NULL CHECK (attestation IN ('host', 'reported')),
  lane_root       TEXT,
  first_seen_at   TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  PRIMARY KEY (session_id, agent)
);
CREATE TABLE IF NOT EXISTS path_leases (
  id              TEXT PRIMARY KEY,
  work_id         TEXT NOT NULL REFERENCES work_items(id),
  session_id      TEXT NOT NULL,
  agent           TEXT,
  lane_root       TEXT NOT NULL,
  branch          TEXT,
  path            TEXT NOT NULL,
  mode            TEXT NOT NULL CHECK (mode IN ('exclusive', 'shared')),
  token           TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  until           TEXT NOT NULL,
  released_at     TEXT,
  release_reason  TEXT
);
CREATE INDEX IF NOT EXISTS path_leases_live ON path_leases (released_at, until);
`;

/** Columns format 4 adds to format-3 tables, in the order the fresh schema declares them. */
export const FORMAT4_COLUMNS: ReadonlyArray<readonly [table: string, column: string, decl: string]> = [
  ['work_items', 'claim_session', 'TEXT'],
  ['work_items', 'claim_agent', 'TEXT'],
  ['work_items', 'claim_lane', 'TEXT'],
  ['work_items', 'claim_touched_at', 'TEXT'],
  ['work_items', 'handoff_json', 'TEXT'],
  ['step_runs', 'lease_nonce', 'TEXT'],
  ['activity_events', 'session_id', 'TEXT'],
  ['activity_events', 'agent', 'TEXT'],
  ['activity_events', 'channel', 'TEXT'],
  ['decisions', 'channel', 'TEXT'],
  ['grants', 'run_id', 'TEXT'],
  ['grants', 'step_run_id', 'TEXT'],
  ['grants', 'channel', 'TEXT'],
  ['statements', 'channel', 'TEXT'],
];

/**
 * Format 3 to 4. Existing claims keep their owners and expire as they would
 * have; the new identity columns stay empty for rows written before them.
 * Every held claim's token is replaced by a random nonce nobody holds: a
 * format-3 token is derived from the claim's owner, time, and revision,
 * which any reader can see, so no token issued before the upgrade settles
 * anything after it. The item stays held until its claim expires.
 *
 * An upgraded store holds every table, column, constraint, index, and
 * trigger a fresh store has, with two exceptions the upgrade tests pin:
 * - In a store that was once format 2, the columns format 3 added to
 *   statements, claims, and source_snapshots follow every column format 2
 *   declared (a fresh store declares them before created_at, or taken_at),
 *   because ALTER TABLE only appends. Rows are read by column name, never by
 *   position.
 * - A format-3 store whose statements.quoted and workflow_runs.cancel_requested
 *   were added without their CHECK (0 or 1) keeps them without it: SQLite
 *   cannot add a constraint to an existing column. Construct writes only 0
 *   or 1 there.
 */
export function migrateV3ToV4(db: DatabaseSync): void {
  for (const [table, column, decl] of FORMAT4_COLUMNS) addColumn(db, table, column, decl);
  db.exec(FORMAT4_TABLES_SQL);
  const held = db.prepare('SELECT id FROM work_items WHERE claim_token IS NOT NULL').all() as Array<{ id: string }>;
  const reissue = db.prepare('UPDATE work_items SET claim_token = ? WHERE id = ?');
  for (const { id } of held) reissue.run(randomUUID(), id);
  db.prepare(`UPDATE meta SET value = '4' WHERE key = 'format_version'`).run();
}


/** Complete format 4 adds coordination tables to format 3. */
export function isCompleteV4(db: DatabaseSync): boolean {
  const names = tableNames(db);
  return [...V3_REQUIRED_TABLES, 'sessions', 'session_agents', 'path_leases'].every((t) => names.has(t));
}

/** Scope an occurrence key to its standing intent, preserving all recorded rows. */
export function migrateV4ToV5(db: DatabaseSync): void {
  db.exec(`CREATE TABLE trigger_firings_v5 (
    id TEXT PRIMARY KEY,
    trigger_id TEXT NOT NULL REFERENCES triggers(id),
    idempotency_key TEXT NOT NULL,
    fired_at TEXT NOT NULL,
    run_id TEXT REFERENCES workflow_runs(id),
    outcome TEXT NOT NULL CHECK (outcome IN ('started', 'skipped_overlap', 'replaced', 'deduplicated', 'blocked', 'disabled')),
    reason TEXT,
    UNIQUE (trigger_id, idempotency_key)
  );
  INSERT INTO trigger_firings_v5 SELECT * FROM trigger_firings ORDER BY rowid;
  DROP TABLE trigger_firings;
  ALTER TABLE trigger_firings_v5 RENAME TO trigger_firings;
  CREATE INDEX trigger_firings_trigger ON trigger_firings (trigger_id, fired_at);`);
  db.prepare("UPDATE meta SET value = '5' WHERE key = 'format_version'").run();
}
