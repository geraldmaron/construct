/*
 * ddl-postgres.sql — Postgres backend for the workspace-control-plane dynamic
 * capability/dependency graph store (design artifact for construct-b0nny.2;
 * built by construct-b0nny.3).
 *
 * Shared / multi-workspace deployment. Intended to be applied by lib/db/migrate.mjs
 * (postgres.js `sql.unsafe` over a numbered migration file, transactional per
 * lib/db/migrate.mjs `applyMigrations`); every table carries the `construct_`
 * prefix and a non-null `workspace` scope so one shared database holds many
 * workspaces with no cross-workspace edge leakage (target-model.md: cross-workspace
 * edges disallowed).
 *
 * Portable with ddl-sqlite.sql by construction: identical table names, identical
 * column names, identical CHECK vocabularies, and query text (queries.sql) that
 * uses a LIKE-based cycle guard and TEXT path accumulation instead of Postgres
 * arrays, so a parity harness can assert byte-equal result sets across both
 * backends (directive §4 day-one milestone: "equivalent results on SQLite and
 * Postgres").
 *
 * Referential integrity between edges and nodes is deliberately NOT a foreign key.
 * Build unions all seeders before writing (lib/graph/cli.mjs runBuild), so an edge
 * can be staged before its endpoint node; and a hard FK with ON DELETE CASCADE
 * would silently drop edges on node deletion, defeating the change-impact gate
 * whose whole job is to BLOCK a deletion that leaves active inbound edges
 * (directive §4). Dangling edges are a `validate` finding instead, mirroring the
 * existing lib/graph/validate.mjs dangling-`secures` check.
 */

-- A graph node is a non-authoritative representation of a domain object (or a
-- code/doc/infra element). source_of_truth_store/_ref point BACK to the owning
-- store so the graph never becomes the source of truth (directive §4; target-model
-- concept 17). Ports the store.mjs node shape {id,type,name,attrs} and adds the
-- directive §4 per-node metadata: version, workspace scope, provenance,
-- confidence, lifecycle, owner, rebuild strategy, conflict status, timestamps.

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

-- An edge is a typed, directed relationship. It preserves the store.mjs de-dup
-- identity (from|rel|to, store.mjs edgeKey) scoped by workspace, and the summed
-- `weight` de-dup semantics (store.mjs normalizeEdges). `inferred` separates
-- discovered/runtime edges from declared ones (directive §4: "Inferred edges
-- distinguishable from declared"); `state` carries the edge lifecycle so
-- staleness marks an edge stale without deleting it.

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

-- Per-workspace singleton mirroring the store.mjs meta.json (schemaVersion,
-- generatedAt, sourceHash, counts) plus the freshness state machine slot used by
-- the reconciliation decision (see design doc § Reconciliation).

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

-- Per-source seed hashes ported from lib/graph/staleness.mjs SOURCE_GROUPS:
-- one row per named seed source (registry, overlays, specialistsOrg, plugins,
-- providerManifests, workflowManifests) so `drift` can name WHICH source moved,
-- not just that something did.

CREATE TABLE IF NOT EXISTS construct_graph_source_hash (
  workspace   TEXT NOT NULL,
  source_name TEXT NOT NULL,
  hash        TEXT NOT NULL,
  hashed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace, source_name)
);

-- Transactional outbox (directive §4: "transactional outbox for graph-affecting
-- events"). A domain mutation and its graph delta are written in ONE transaction:
-- the domain write plus an outbox row. A separate in-process applier drains
-- pending rows and applies node/edge upserts/deletes idempotently, so a crash
-- between the domain write and the graph update loses nothing. `declared`
-- distinguishes a bead-declared change (directive §4: "Every implementation bead
-- declares graph nodes it creates/changes/deprecates/deletes") from a discovered
-- one — this is where change-intent declaration lives in this design, built fresh
-- (the prior lib/graph/change-intent.mjs is unreachable; see design doc § A3).

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

-- Append-only ledger of applied outbox events. seq mirrors the applied outbox_id;
-- a gap in the per-workspace seq sequence proves an event was lost, which the
-- reconciliation decision reads as a trust-loss trigger forcing a full rebuild
-- (see design doc § Reconciliation).

CREATE TABLE IF NOT EXISTS construct_graph_applied_log (
  workspace         TEXT NOT NULL,
  seq               BIGINT NOT NULL,
  event_type        TEXT NOT NULL,
  node_or_edge_key  TEXT NOT NULL,
  applied_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace, seq)
);
