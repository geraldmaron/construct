-- 001_graph_foundation.sql — SQLite schema for the relational graph store
-- (construct-b0nny.3, implementing the design in docs/notes/research/
-- workspace-control-plane/synthesis/graph-store-design.md and the DDL at
-- .../graph-store/ddl-sqlite.sql). Six tables: typed nodes, typed directed
-- edges, per-workspace meta/freshness, per-source seed hashes, a
-- transactional outbox, and an applied-event ledger. No edge->node foreign
-- key by design — build stages edges before endpoint nodes exist, and a
-- cascading delete would defeat the change-impact gate. Column names and
-- CHECK vocabularies match ddl-postgres.sql exactly so queries.sql runs
-- unchanged on both backends.

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
  provenance_sources    TEXT NOT NULL DEFAULT '[]',
  attrs                 TEXT NOT NULL DEFAULT '{}',
  first_observed        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_verified         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
  inferred            INTEGER NOT NULL DEFAULT 0 CHECK (inferred IN (0,1)),
  confidence          REAL,
  provenance_sources  TEXT NOT NULL DEFAULT '[]',
  state               TEXT NOT NULL DEFAULT 'active'
                        CHECK (state IN ('active','stale','superseded')),
  first_observed      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_verified       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
  generated_at        TEXT,
  source_hash         TEXT,
  node_count          INTEGER NOT NULL DEFAULT 0,
  edge_count          INTEGER NOT NULL DEFAULT 0,
  last_reconciled_at  TEXT,
  freshness           TEXT NOT NULL DEFAULT 'fresh'
                        CHECK (freshness IN
                          ('fresh','incremental_dirty','source_drift','reconciling','rebuilding','suspect'))
);

CREATE TABLE IF NOT EXISTS construct_graph_source_hash (
  workspace   TEXT NOT NULL,
  source_name TEXT NOT NULL,
  hash        TEXT NOT NULL,
  hashed_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace, source_name)
);

CREATE TABLE IF NOT EXISTS construct_graph_outbox (
  outbox_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace    TEXT NOT NULL,
  event_type   TEXT NOT NULL
                 CHECK (event_type IN
                   ('node_upsert','node_delete','edge_upsert','edge_delete','source_rehash')),
  payload      TEXT NOT NULL,
  origin       TEXT NOT NULL,
  declared     INTEGER NOT NULL DEFAULT 0 CHECK (declared IN (0,1)),
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','applying','applied','failed','dead_letter')),
  attempt      INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  applied_at   TEXT,
  last_error   TEXT
);

CREATE INDEX IF NOT EXISTS construct_graph_outbox_pending_idx
  ON construct_graph_outbox (workspace, outbox_id)
  WHERE status IN ('pending','failed');

CREATE TABLE IF NOT EXISTS construct_graph_applied_log (
  workspace         TEXT NOT NULL,
  seq               INTEGER NOT NULL,
  event_type        TEXT NOT NULL,
  node_or_edge_key  TEXT NOT NULL,
  applied_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace, seq)
);
