/**
 * kernel/state/schema.ts — clean schema v1 DDL.
 *
 * Only aggregates with named product use cases. Task execution and deliverable
 * trust are separate tables/state machines on purpose. CREATE IF NOT EXISTS so
 * additive tables appear on reopen without a format bump during alpha.
 */

export const SCHEMA_V1_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id           TEXT PRIMARY KEY,
  outcome      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  created_at   TEXT NOT NULL,
  closed_at    TEXT
);

CREATE TABLE IF NOT EXISTS run_concerns (
  run_id   TEXT NOT NULL REFERENCES runs(id),
  domain   TEXT NOT NULL,
  why      TEXT NOT NULL,
  PRIMARY KEY (run_id, domain)
);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES runs(id),
  role          TEXT NOT NULL,
  brief_json    TEXT NOT NULL,
  state         TEXT NOT NULL CHECK (state IN ('pending', 'leased', 'done', 'failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  lease_owner   TEXT,
  lease_until   TEXT,
  result_json   TEXT,
  error_json    TEXT,
  enqueued_at   TEXT NOT NULL,
  settled_at    TEXT
);
CREATE INDEX IF NOT EXISTS tasks_claimable ON tasks (state, lease_until);
CREATE INDEX IF NOT EXISTS tasks_run ON tasks (run_id, enqueued_at);

CREATE TABLE IF NOT EXISTS deliverables (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL UNIQUE REFERENCES tasks(id),
  run_id        TEXT NOT NULL REFERENCES runs(id),
  trust_state   TEXT NOT NULL CHECK (trust_state IN ('none', 'draft', 'reviewed', 'challenged', 'accepted', 'final')),
  body_json     TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_members (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  title                 TEXT NOT NULL,
  mission               TEXT NOT NULL,
  concerns_json         TEXT NOT NULL,
  skill_ids_json        TEXT NOT NULL,
  source_ids_json       TEXT NOT NULL,
  execution_policy_json TEXT NOT NULL,
  approval_policy_json  TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('active', 'paused', 'retired')),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  locator         TEXT NOT NULL,
  authority       TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('active', 'retired')),
  metadata_json   TEXT,
  created_at      TEXT NOT NULL,
  retired_at      TEXT
);

CREATE TABLE IF NOT EXISTS routines (
  id                      TEXT PRIMARY KEY,
  owner_staff_id          TEXT REFERENCES staff_members(id),
  enabled                 INTEGER NOT NULL DEFAULT 1,
  trigger_kind            TEXT NOT NULL CHECK (trigger_kind IN ('manual', 'scheduled', 'event')),
  trigger_json            TEXT NOT NULL,
  workflow_json           TEXT NOT NULL,
  input_source_ids_json   TEXT NOT NULL,
  expected_output         TEXT NOT NULL,
  execution_policy_json   TEXT NOT NULL,
  approval_boundary_json  TEXT NOT NULL,
  no_data_policy          TEXT NOT NULL,
  stale_data_policy       TEXT NOT NULL,
  retry_policy_json       TEXT NOT NULL,
  last_run_at             TEXT,
  next_run_at             TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
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
CREATE INDEX IF NOT EXISTS decisions_open ON decisions (state, raised_at);

CREATE TABLE IF NOT EXISTS integration_state (
  host_id              TEXT PRIMARY KEY,
  status               TEXT NOT NULL CHECK (status IN ('installed', 'absent', 'broken')),
  construct_version    TEXT NOT NULL,
  generation_version   TEXT NOT NULL,
  content_fingerprint  TEXT,
  path                 TEXT,
  kind                 TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  kind       TEXT NOT NULL,
  run_id     TEXT,
  task_id    TEXT,
  payload    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_run ON activity_events (run_id, id);
`;
