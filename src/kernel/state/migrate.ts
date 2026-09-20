/**
 * kernel/state/migrate.ts — one-way additive upgrade from construct-state 2
 * to construct-state 3.
 *
 * Format 1 and anything else remain refused unread. Format 2 that is missing
 * a format-2 table is also refused: this migrator adds the native work
 * ledger and provenance columns, it does not repair a truncated database.
 * After native writes begin, rolling back to a format-2 snapshot would
 * drop them; that is why this upgrade is one-way.
 */

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

export function migrateV2ToV3(db: DatabaseSync): void {
  addColumn(db, 'statements', 'locator', 'TEXT');
  addColumn(db, 'statements', 'span_json', 'TEXT');
  addColumn(db, 'statements', 'excerpt', 'TEXT');
  addColumn(db, 'statements', 'source_revision', 'TEXT');
  addColumn(db, 'statements', 'extractor_version', 'TEXT');
  addColumn(db, 'statements', 'content_digest', 'TEXT');
  addColumn(db, 'statements', 'coverage_json', 'TEXT');
  addColumn(db, 'statements', 'quoted', 'INTEGER NOT NULL DEFAULT 0');

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
  addColumn(db, 'workflow_runs', 'cancel_requested', 'INTEGER NOT NULL DEFAULT 0');

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_invocation ON workflow_runs (invocation_id) WHERE invocation_id IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS workflow_runs_work_identity ON workflow_runs (work_identity, state)');

  db.exec(WORK_SQL);
  db.prepare(`UPDATE meta SET value = '3' WHERE key = 'format_version'`).run();
}
