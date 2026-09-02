/**
 * kernel/state/schema.ts — Construct state format 2.
 *
 * One database per project. Columns that take part in policy, selection,
 * uniqueness, or a state transition are normalized and CHECKed here; JSON
 * columns carry versioned payloads that the owning module validates on the
 * way in and out. The activity table is append-only by trigger, not by
 * caller discipline.
 */

export const REQUIRED_TABLES = [
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
  'activity_events',
] as const;

export const SCHEMA_SQL = `
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- The project as Construct understands it. One row; onboarding_state says
-- how much of it a person has confirmed.
CREATE TABLE project_profile (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  name             TEXT,
  purpose          TEXT,
  scale            TEXT CHECK (scale IN ('solo', 'side_project', 'team', 'multi_team', 'organization')),
  lifecycle_stage  TEXT,
  primary_outcome  TEXT,
  risk_posture     TEXT,
  review_cadence   TEXT,
  onboarding_state TEXT NOT NULL CHECK (onboarding_state IN ('incomplete', 'drafted', 'confirmed')),
  updated_at       TEXT NOT NULL
);

-- Constitution statements and remembered records. A remembered decision or
-- note is the smallest record: one row here, nothing else.
CREATE TABLE statements (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN (
                    'principle', 'constraint', 'non_goal', 'success_measure', 'invariant',
                    'glossary_entry', 'unknown', 'decision', 'note', 'outcome',
                    'canonical_artifact', 'ownership', 'boundary'
                  )),
  text            TEXT NOT NULL,
  term            TEXT,
  status          TEXT NOT NULL CHECK (status IN ('proposed', 'confirmed', 'superseded', 'retired')),
  provenance      TEXT NOT NULL CHECK (provenance IN ('user', 'discovery', 'workflow')),
  source_id       TEXT REFERENCES sources(id),
  run_id          TEXT REFERENCES workflow_runs(id),
  superseded_by   TEXT REFERENCES statements(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX statements_kind_status ON statements (kind, status);
CREATE UNIQUE INDEX statements_glossary_term ON statements (term)
  WHERE kind = 'glossary_entry' AND status IN ('proposed', 'confirmed');

CREATE TABLE sources (
  id                    TEXT PRIMARY KEY,
  kind                  TEXT NOT NULL,
  purpose               TEXT NOT NULL,
  locator               TEXT,
  authority_level       TEXT NOT NULL CHECK (authority_level IN ('authoritative', 'informative', 'untrusted')),
  freshness_hours       INTEGER CHECK (freshness_hours IS NULL OR freshness_hours > 0),
  sensitivity           TEXT NOT NULL CHECK (sensitivity IN ('public', 'internal', 'confidential', 'restricted')),
  retention             TEXT,
  can_read              INTEGER NOT NULL CHECK (can_read IN (0, 1)),
  can_write             INTEGER NOT NULL CHECK (can_write IN (0, 1)),
  identity_mapping_json TEXT,
  reachability          TEXT NOT NULL CHECK (reachability IN ('unknown', 'reachable', 'unreachable')),
  last_snapshot_id      TEXT,
  status                TEXT NOT NULL CHECK (status IN ('active', 'retired')),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  retired_at            TEXT
);

-- Authority is per claim type. A row with authoritative = 0 is an explicit
-- statement of what the source is NOT authoritative for.
CREATE TABLE source_authority (
  source_id     TEXT NOT NULL REFERENCES sources(id),
  claim_type    TEXT NOT NULL,
  authoritative INTEGER NOT NULL CHECK (authoritative IN (0, 1)),
  PRIMARY KEY (source_id, claim_type)
);

CREATE TABLE source_snapshots (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL REFERENCES sources(id),
  digest      TEXT NOT NULL,
  summary     TEXT,
  evidence_ref TEXT,
  taken_at    TEXT NOT NULL,
  UNIQUE (source_id, digest)
);
CREATE INDEX source_snapshots_recent ON source_snapshots (source_id, taken_at);

CREATE TABLE entities (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'artifact', 'system', 'person', 'team', 'initiative', 'requirement',
                  'work_item', 'code_component', 'test', 'metric', 'decision'
                )),
  name          TEXT NOT NULL,
  external_ref  TEXT,
  attributes_json TEXT,
  status        TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'retired')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX entities_external ON entities (kind, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX entities_kind ON entities (kind, status);

CREATE TABLE relations (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN (
                'governs', 'implements', 'verifies', 'depends_on', 'feeds', 'supersedes',
                'contradicts', 'owned_by', 'contributes_to', 'sourced_from'
              )),
  from_id     TEXT NOT NULL REFERENCES entities(id),
  to_id       TEXT NOT NULL REFERENCES entities(id),
  basis       TEXT NOT NULL CHECK (basis IN ('formal', 'declared', 'observed', 'inferred')),
  confidence  REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  source_id   TEXT REFERENCES sources(id),
  status      TEXT NOT NULL CHECK (status IN ('proposed', 'confirmed', 'retired')),
  created_at  TEXT NOT NULL,
  CHECK (from_id <> to_id),
  UNIQUE (kind, from_id, to_id)
);
CREATE INDEX relations_from ON relations (from_id, kind);
CREATE INDEX relations_to ON relations (to_id, kind);

CREATE TABLE claims (
  id              TEXT PRIMARY KEY,
  subject_id      TEXT NOT NULL REFERENCES entities(id),
  claim_type      TEXT NOT NULL,
  statement       TEXT NOT NULL,
  value_json      TEXT,
  source_id       TEXT REFERENCES sources(id),
  provenance      TEXT NOT NULL CHECK (provenance IN ('user', 'source', 'discovery', 'workflow')),
  authority       TEXT NOT NULL CHECK (authority IN ('authoritative', 'informative', 'untrusted')),
  sensitivity     TEXT NOT NULL CHECK (sensitivity IN ('public', 'internal', 'confidential', 'restricted')),
  confidence      REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status          TEXT NOT NULL CHECK (status IN ('observed', 'inferred', 'confirmed', 'superseded')),
  observed_at     TEXT NOT NULL,
  fresh_until     TEXT,
  superseded_by   TEXT REFERENCES claims(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX claims_subject ON claims (subject_id, claim_type, status);

CREATE TABLE staff_members (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  title       TEXT NOT NULL,
  mission     TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('active', 'paused', 'retired')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE TABLE staff_capabilities (
  staff_id    TEXT NOT NULL REFERENCES staff_members(id),
  capability  TEXT NOT NULL,
  PRIMARY KEY (staff_id, capability)
);
CREATE TABLE staff_skills (
  staff_id    TEXT NOT NULL REFERENCES staff_members(id),
  skill_id    TEXT NOT NULL,
  PRIMARY KEY (staff_id, skill_id)
);

CREATE TABLE resolved_skills (
  skill_id    TEXT PRIMARY KEY,
  version     TEXT NOT NULL,
  digest      TEXT NOT NULL,
  origin      TEXT NOT NULL CHECK (origin IN ('builtin', 'project')),
  resolved_at TEXT NOT NULL
);
CREATE TABLE resolved_workflows (
  workflow_id TEXT PRIMARY KEY,
  version     TEXT NOT NULL,
  digest      TEXT NOT NULL,
  origin      TEXT NOT NULL CHECK (origin IN ('builtin', 'project')),
  resolved_at TEXT NOT NULL
);

CREATE TABLE workflow_runs (
  id                TEXT PRIMARY KEY,
  workflow_id       TEXT NOT NULL,
  workflow_version  TEXT NOT NULL,
  interaction_class TEXT NOT NULL CHECK (interaction_class IN ('remember', 'manage', 'maintain')),
  state             TEXT NOT NULL CHECK (state IN (
                      'preflight', 'blocked', 'ready', 'running', 'waiting_for_decision',
                      'succeeded', 'failed', 'cancelled'
                    )),
  trigger_kind      TEXT NOT NULL CHECK (trigger_kind IN ('manual', 'schedule', 'event')),
  idempotency_key   TEXT NOT NULL UNIQUE,
  executor_kind     TEXT NOT NULL CHECK (executor_kind IN ('interactive', 'headless')),
  executor_id       TEXT NOT NULL,
  host_id           TEXT,
  session_id        TEXT,
  input_json        TEXT NOT NULL,
  preflight_json    TEXT,
  state_reason      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  finished_at       TEXT
);
CREATE INDEX workflow_runs_active ON workflow_runs (state, updated_at);
CREATE INDEX workflow_runs_workflow ON workflow_runs (workflow_id, created_at);

CREATE TABLE step_runs (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES workflow_runs(id),
  step_id         TEXT NOT NULL,
  ordinal         INTEGER NOT NULL,
  permission_tier TEXT NOT NULL CHECK (permission_tier IN (
                    'observe', 'draft', 'project_write', 'external_write', 'destructive', 'licensed_judgment'
                  )),
  state           TEXT NOT NULL CHECK (state IN (
                    'pending', 'ready', 'leased', 'waiting_for_decision',
                    'succeeded', 'failed', 'skipped', 'cancelled'
                  )),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts >= 1),
  lease_owner     TEXT,
  lease_until     TEXT,
  input_json      TEXT,
  output_json     TEXT,
  state_reason    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  finished_at     TEXT,
  UNIQUE (run_id, step_id)
);
CREATE INDEX step_runs_claimable ON step_runs (state, lease_until);
CREATE INDEX step_runs_run ON step_runs (run_id, ordinal);

CREATE TABLE step_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  step_run_id TEXT NOT NULL REFERENCES step_runs(id),
  attempt     INTEGER NOT NULL,
  owner       TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  outcome     TEXT CHECK (outcome IS NULL OR outcome IN ('succeeded', 'failed', 'expired', 'cancelled', 'paused')),
  error_json  TEXT,
  UNIQUE (step_run_id, attempt)
);

CREATE TABLE deliverables (
  id                TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES workflow_runs(id),
  step_run_id       TEXT REFERENCES step_runs(id),
  kind              TEXT NOT NULL,
  body_json         TEXT NOT NULL,
  trust_state       TEXT NOT NULL CHECK (trust_state IN (
                      'draft', 'validated', 'challenged', 'accepted', 'final', 'rejected'
                    )),
  verification_json TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX deliverables_step ON deliverables (step_run_id) WHERE step_run_id IS NOT NULL;
CREATE INDEX deliverables_run ON deliverables (run_id, created_at);

CREATE TABLE decisions (
  id              TEXT PRIMARY KEY,
  run_id          TEXT REFERENCES workflow_runs(id),
  step_run_id     TEXT REFERENCES step_runs(id),
  kind            TEXT NOT NULL CHECK (kind IN ('decision', 'approval', 'clarification', 'blocked')),
  question        TEXT NOT NULL,
  options_json    TEXT,
  subject_json    TEXT,
  state           TEXT NOT NULL CHECK (state IN ('open', 'resolved', 'withdrawn')),
  resolution_json TEXT,
  raised_at       TEXT NOT NULL,
  resolved_at     TEXT,
  resolved_by     TEXT
);
CREATE INDEX decisions_open ON decisions (state, raised_at);

-- Standing and break-glass grants. NULL in a scope column means "any" for a
-- standing grant; break-glass rows must name their exact target and expiry.
CREATE TABLE grants (
  id              TEXT PRIMARY KEY,
  action_tier     TEXT NOT NULL CHECK (action_tier IN (
                    'observe', 'draft', 'project_write', 'external_write', 'destructive', 'licensed_judgment'
                  )),
  target_system   TEXT NOT NULL,
  target_resource TEXT,
  workflow_id     TEXT,
  executor_id     TEXT,
  max_impact      TEXT,
  budget_cents    INTEGER CHECK (budget_cents IS NULL OR budget_cents >= 0),
  starts_at       TEXT NOT NULL,
  ends_at         TEXT,
  granted_by      TEXT NOT NULL,
  break_glass     INTEGER NOT NULL CHECK (break_glass IN (0, 1)),
  reason          TEXT,
  revoked_at      TEXT,
  revoked_reason  TEXT,
  created_at      TEXT NOT NULL,
  CHECK (break_glass = 0 OR (reason IS NOT NULL AND ends_at IS NOT NULL AND target_resource IS NOT NULL AND executor_id IS NOT NULL)),
  CHECK (action_tier <> 'licensed_judgment')
);
CREATE INDEX grants_lookup ON grants (action_tier, target_system, revoked_at);

CREATE TABLE observations (
  id            TEXT PRIMARY KEY,
  run_id        TEXT REFERENCES workflow_runs(id),
  source_id     TEXT REFERENCES sources(id),
  kind          TEXT NOT NULL,
  summary       TEXT NOT NULL,
  evidence_json TEXT,
  observed_at   TEXT NOT NULL
);

CREATE TABLE drift_findings (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES workflow_runs(id),
  kind          TEXT NOT NULL CHECK (kind IN (
                  'stale_dependent_claims', 'unverified_obligation', 'change_without_decision',
                  'unlinked_requirement', 'contradicts_obligation', 'duplicate_active_document',
                  'initiative_incomplete', 'work_without_goal', 'capacity_conflict',
                  'insufficient_authority'
                )),
  summary       TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  affected_json TEXT NOT NULL,
  confidence    REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  repair_path   TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'repaired', 'dismissed')),
  created_at    TEXT NOT NULL,
  resolved_at   TEXT
);
CREATE INDEX drift_findings_open ON drift_findings (status, created_at);

CREATE TABLE lessons (
  id            TEXT PRIMARY KEY,
  statement     TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status        TEXT NOT NULL CHECK (status IN (
                  'proposed', 'checked', 'approved', 'admitted', 'superseded', 'invalidated'
                )),
  evidence_json TEXT NOT NULL,
  scope_json    TEXT NOT NULL,
  run_id        TEXT REFERENCES workflow_runs(id),
  superseded_by TEXT REFERENCES lessons(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE activity_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  kind         TEXT NOT NULL,
  run_id       TEXT,
  step_run_id  TEXT,
  actor        TEXT,
  payload_json TEXT NOT NULL
);
CREATE INDEX activity_run ON activity_events (run_id, id);
CREATE TRIGGER activity_events_no_update BEFORE UPDATE ON activity_events
BEGIN
  SELECT RAISE(ABORT, 'activity_events is append-only');
END;
CREATE TRIGGER activity_events_no_delete BEFORE DELETE ON activity_events
BEGIN
  SELECT RAISE(ABORT, 'activity_events is append-only');
END;
`;
