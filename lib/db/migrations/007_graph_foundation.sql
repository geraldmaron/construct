-- 007_graph_foundation.sql — Postgres schema for the relational graph store
-- (construct-b0nny.3), applied via lib/db/migrate.mjs. Structural parity with
-- lib/graph/relational/migrations/001_graph_foundation.sql (SQLite): same
-- table/column names and CHECK vocabularies so queries.sql runs unchanged on
-- both — see docs/notes/research/workspace-control-plane/synthesis/
-- graph-store/ddl-postgres.sql for the design rationale. No edge->node
-- foreign key by design (build stages edges before endpoint nodes exist; a
-- cascading delete would defeat the change-impact gate).

CREATE TABLE IF NOT EXISTS construct_graph_nodes (
  id                    TEXT NOT NULL,
  workspace             TEXT NOT NULL,
  node_type             TEXT NOT NULL,
  name                  TEXT,
  version               INTEGER NOT NULL DEFAULT 1,
  lifecycle             TEXT NOT NULL DEFAULT 'active'
                          CHECK (lifecycle IN ('active','deprecated','superseded','deleted','unknown')),
  source_of_truth_store TEXT,
  source_of_truth_ref   TEXT,
  owner                 TEXT,
  rebuild_strategy      TEXT,
  confidence            REAL,
  conflict_status       TEXT NOT NULL DEFAULT 'none'
                          CHECK (conflict_status IN ('none','contested')),
  provenance_sources    JSONB NOT NULL DEFAULT '[]'::jsonb,
  attrs                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_observed        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace, id)
);

CREATE INDEX IF NOT EXISTS construct_graph_nodes_type_idx
  ON construct_graph_nodes (workspace, node_type, lifecycle);

CREATE TABLE IF NOT EXISTS construct_graph_edges (
  workspace           TEXT NOT NULL,
  from_id             TEXT NOT NULL,
  rel                 TEXT NOT NULL,
  to_id               TEXT NOT NULL,
  weight              REAL NOT NULL DEFAULT 1,
  inferred            BOOLEAN NOT NULL DEFAULT false,
  confidence          REAL,
  provenance_sources  JSONB NOT NULL DEFAULT '[]'::jsonb,
  state               TEXT NOT NULL DEFAULT 'active'
                        CHECK (state IN ('active','stale','superseded')),
  first_observed      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace, from_id, rel, to_id)
);

CREATE INDEX IF NOT EXISTS construct_graph_edges_forward_idx
  ON construct_graph_edges (workspace, from_id, rel);
CREATE INDEX IF NOT EXISTS construct_graph_edges_reverse_idx
  ON construct_graph_edges (workspace, to_id, rel);
CREATE INDEX IF NOT EXISTS construct_graph_edges_rel_idx
  ON construct_graph_edges (workspace, rel);

CREATE TABLE IF NOT EXISTS construct_graph_meta (
  workspace           TEXT PRIMARY KEY,
  schema_version      INTEGER NOT NULL,
  generated_at        TIMESTAMPTZ,
  source_hash         TEXT,
  node_count          INTEGER NOT NULL DEFAULT 0,
  edge_count          INTEGER NOT NULL DEFAULT 0,
  last_reconciled_at  TIMESTAMPTZ,
  freshness           TEXT NOT NULL DEFAULT 'fresh'
                        CHECK (freshness IN
                          ('fresh','incremental_dirty','source_drift','reconciling','rebuilding','suspect'))
);

CREATE TABLE IF NOT EXISTS construct_graph_source_hash (
  workspace   TEXT NOT NULL,
  source_name TEXT NOT NULL,
  hash        TEXT NOT NULL,
  hashed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace, source_name)
);

CREATE TABLE IF NOT EXISTS construct_graph_outbox (
  outbox_id    BIGSERIAL PRIMARY KEY,
  workspace    TEXT NOT NULL,
  event_type   TEXT NOT NULL
                 CHECK (event_type IN
                   ('node_upsert','node_delete','edge_upsert','edge_delete','source_rehash')),
  payload      JSONB NOT NULL,
  origin       TEXT NOT NULL,
  declared     BOOLEAN NOT NULL DEFAULT false,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','applying','applied','failed','dead_letter')),
  attempt      INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at   TIMESTAMPTZ,
  last_error   TEXT
);

CREATE INDEX IF NOT EXISTS construct_graph_outbox_pending_idx
  ON construct_graph_outbox (workspace, outbox_id)
  WHERE status IN ('pending','failed');

CREATE TABLE IF NOT EXISTS construct_graph_applied_log (
  workspace         TEXT NOT NULL,
  seq               BIGINT NOT NULL,
  event_type        TEXT NOT NULL,
  node_or_edge_key  TEXT NOT NULL,
  applied_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace, seq)
);
