/*
 * ddl-sqlite.sql — embedded backend for the workspace-control-plane dynamic
 * capability/dependency graph store (design artifact for construct-b0nny.2;
 * built by construct-b0nny.3).
 *
 * Solo / local-first deployment, run through `node:sqlite` DatabaseSync (Node
 * >=22.5, the same runtime boundary as lib/orchestration/run-store-sqlite.mjs).
 * A single-file database under the machine-scoped state root replaces the
 * `.construct/graph/` JSONL files (nodes.jsonl / edges.jsonl / meta.json) while
 * keeping identical semantics.
 *
 * Byte-for-byte the same table and column names as ddl-postgres.sql. Type
 * differences only: TEXT timestamps (ISO-8601) instead of TIMESTAMPTZ, INTEGER
 * 0/1 instead of BOOLEAN, TEXT JSON instead of JSONB, INTEGER PRIMARY KEY
 * AUTOINCREMENT instead of BIGSERIAL. Every CHECK vocabulary matches Postgres so
 * queries.sql runs unchanged on both and a parity harness can assert identical
 * result sets (directive §4 day-one milestone).
 *
 * No edge->node foreign key: build stages edges before endpoint nodes exist
 * (lib/graph/cli.mjs runBuild unions seeders before writing), and a cascading
 * delete would defeat the change-impact gate. Dangling edges are a `validate`
 * finding, mirroring lib/graph/validate.mjs.
 *
 * PRAGMA foreign_keys stays off; PRAGMA journal_mode=WAL is set by the store
 * factory at open time (not here) so a reader is never blocked by the outbox
 * applier's writes.
 */

-- Graph node: non-authoritative representation of a domain object. Ports the
-- store.mjs {id,type,name,attrs} shape and adds directive §4 per-node metadata.

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

-- Typed directed edge. Preserves the store.mjs from|rel|to de-dup identity and
-- summed weight; `inferred` separates discovered/runtime from declared edges.

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

-- Per-workspace singleton mirroring store.mjs meta.json plus the freshness
-- state-machine slot read by the reconciliation decision.

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

-- Per-source seed hashes ported from lib/graph/staleness.mjs SOURCE_GROUPS.

CREATE TABLE IF NOT EXISTS construct_graph_source_hash (
  workspace   TEXT NOT NULL,
  source_name TEXT NOT NULL,
  hash        TEXT NOT NULL,
  hashed_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace, source_name)
);

-- Transactional outbox (directive §4). Domain write + outbox row commit in one
-- transaction; an in-process applier drains pending rows idempotently. `declared`
-- marks a bead-declared change vs a discovered one (change-intent declaration,
-- built fresh here).

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

-- Append-only applied-event ledger; a gap in per-workspace seq proves a lost
-- event and forces reconciliation to full-rebuild.

CREATE TABLE IF NOT EXISTS construct_graph_applied_log (
  workspace         TEXT NOT NULL,
  seq               INTEGER NOT NULL,
  event_type        TEXT NOT NULL,
  node_or_edge_key  TEXT NOT NULL,
  applied_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace, seq)
);
