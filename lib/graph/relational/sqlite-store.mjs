/**
 * lib/graph/relational/sqlite-store.mjs — CRUD for the relational graph store
 * (SQLite backend).
 *
 * Two write paths share the merge semantics in lib/graph/normalize.mjs so
 * incremental state can never drift from what a full rebuild would produce:
 *   - writeGraph: full-rebuild ("build"). Normalizes the whole node/edge set
 *     in memory, then replaces every row for the workspace in one transaction.
 *   - upsertNode/upsertEdge/deleteNode/deleteEdge: single-row incremental ops
 *     ("update"), read-merge-write per row (attrs shallow-merged last-write-
 *     wins, weight summed, sources unioned) — the same rule normalizeNodes/
 *     normalizeEdges apply in bulk, applied one row at a time.
 *
 * loadGraph reconstructs the exact in-memory shape lib/graph/store.mjs's
 * legacy loadGraph returned ({ nodes: Map, edges, out, in, meta, exists }) so
 * every existing consumer (impact.mjs, gap-queries.mjs, staleness.mjs,
 * validate.mjs, the doctor watcher, the PostToolUse hook, the oracle
 * read-model) keeps working against this backend with zero code changes.
 */

import path from 'node:path';
import { withGraphDb, graphDbPath, graphDbExists } from './sqlite-db.mjs';
import { resolveGraphWorkspace } from './workspace.mjs';
import { normalizeNodes, normalizeEdges, countBy, isInferredSources } from '../normalize.mjs';
import { CURRENT_SCHEMA_VERSION } from './schema-version.mjs';

function nowIso() { return new Date().toISOString(); }

function rowToNode(r) {
  return { id: r.id, type: r.node_type, name: r.name, attrs: JSON.parse(r.attrs || '{}'), lifecycle: r.lifecycle, owner: r.owner, version: r.version };
}

function rowToEdge(r) {
  return { from: r.from_id, to: r.to_id, rel: r.rel, weight: r.weight, sources: JSON.parse(r.provenance_sources || '[]'), inferred: !!r.inferred, state: r.state };
}

function buildAdjacency(edgeList) {
  const out = new Map();
  const inc = new Map();
  for (const e of edgeList) {
    if (!out.has(e.from)) out.set(e.from, []);
    if (!inc.has(e.to)) inc.set(e.to, []);
    out.get(e.from).push(e);
    inc.get(e.to).push(e);
  }
  return { out, inc };
}

/**
 * Full-rebuild write ("build"): replaces every node/edge row for the
 * workspace with the normalized input set, in one transaction.
 *
 * @returns {{ nodeCount: number, edgeCount: number, dir: string }}
 */
export function writeGraph(rootDir, { nodes = [], edges = [], generatedAt = null, sourceHash = null, sourceHashes = null } = {}) {
  const workspace = resolveGraphWorkspace(rootDir);
  const normNodes = normalizeNodes(nodes);
  const normEdges = normalizeEdges(edges);
  const ts = generatedAt || nowIso();

  withGraphDb(rootDir, (db) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM construct_graph_nodes WHERE workspace = :workspace').run({ ':workspace': workspace });
      db.prepare('DELETE FROM construct_graph_edges WHERE workspace = :workspace').run({ ':workspace': workspace });

      const insertNode = db.prepare(`INSERT INTO construct_graph_nodes
        (id, workspace, node_type, name, version, attrs, provenance_sources, first_observed, last_verified)
        VALUES (:id, :workspace, :node_type, :name, 1, :attrs, '[]', :ts, :ts)`);
      for (const n of normNodes) {
        insertNode.run({ ':id': n.id, ':workspace': workspace, ':node_type': n.type, ':name': n.name ?? n.id, ':attrs': JSON.stringify(n.attrs || {}), ':ts': ts });
      }

      const insertEdge = db.prepare(`INSERT INTO construct_graph_edges
        (workspace, from_id, rel, to_id, weight, inferred, provenance_sources, first_observed, last_verified)
        VALUES (:workspace, :from_id, :rel, :to_id, :weight, :inferred, :sources, :ts, :ts)`);
      for (const e of normEdges) {
        insertEdge.run({
          ':workspace': workspace, ':from_id': e.from, ':rel': e.rel, ':to_id': e.to,
          ':weight': e.weight || 1, ':inferred': isInferredSources(e.sources) ? 1 : 0,
          ':sources': JSON.stringify(e.sources || []), ':ts': ts,
        });
      }

      db.prepare(`INSERT INTO construct_graph_meta
          (workspace, schema_version, generated_at, source_hash, node_count, edge_count, last_reconciled_at, freshness)
        VALUES (:workspace, :schema_version, :generated_at, :source_hash, :node_count, :edge_count, :now, 'fresh')
        ON CONFLICT(workspace) DO UPDATE SET
          schema_version = excluded.schema_version, generated_at = excluded.generated_at, source_hash = excluded.source_hash,
          node_count = excluded.node_count, edge_count = excluded.edge_count,
          last_reconciled_at = excluded.last_reconciled_at, freshness = 'fresh'`)
        .run({ ':workspace': workspace, ':schema_version': CURRENT_SCHEMA_VERSION, ':generated_at': generatedAt, ':source_hash': sourceHash, ':node_count': normNodes.length, ':edge_count': normEdges.length, ':now': nowIso() });

      if (sourceHashes) {
        const upsertHash = db.prepare(`INSERT INTO construct_graph_source_hash (workspace, source_name, hash, hashed_at)
          VALUES (:workspace, :source_name, :hash, :now)
          ON CONFLICT(workspace, source_name) DO UPDATE SET hash = excluded.hash, hashed_at = excluded.hashed_at`);
        for (const [name, hash] of Object.entries(sourceHashes)) {
          upsertHash.run({ ':workspace': workspace, ':source_name': name, ':hash': hash, ':now': nowIso() });
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });

  return { nodeCount: normNodes.length, edgeCount: normEdges.length, dir: path.dirname(graphDbPath(rootDir)) };
}

/**
 * Read the whole workspace graph into the legacy in-memory shape. A project
 * with no graph.db yet returns the empty/non-existent shape without creating
 * one — a pure "does a graph exist" check (staleness, gap queries, the
 * PostToolUse hook on a fresh project) must never itself provision
 * machine-scoped state as a side effect of asking.
 */
export function loadGraph(rootDir) {
  if (!graphDbExists(rootDir)) {
    return { nodes: new Map(), edges: [], out: new Map(), in: new Map(), meta: null, exists: false };
  }
  const workspace = resolveGraphWorkspace(rootDir);
  return withGraphDb(rootDir, (db) => {
    const nodeRows = db.prepare('SELECT * FROM construct_graph_nodes WHERE workspace = :workspace ORDER BY id').all({ ':workspace': workspace });
    const edgeRows = db.prepare('SELECT * FROM construct_graph_edges WHERE workspace = :workspace ORDER BY from_id, rel, to_id').all({ ':workspace': workspace });
    const metaRow = db.prepare('SELECT * FROM construct_graph_meta WHERE workspace = :workspace').get({ ':workspace': workspace });
    const hashRows = db.prepare('SELECT source_name, hash FROM construct_graph_source_hash WHERE workspace = :workspace').all({ ':workspace': workspace });

    const nodes = new Map();
    for (const r of nodeRows) nodes.set(r.id, rowToNode(r));
    const edgeList = edgeRows.map(rowToEdge);
    const { out, inc } = buildAdjacency(edgeList);

    const sourceHashes = hashRows.length ? Object.fromEntries(hashRows.map((r) => [r.source_name, r.hash])) : null;
    const meta = metaRow ? {
      schemaVersion: metaRow.schema_version,
      generatedAt: metaRow.generated_at,
      sourceHash: metaRow.source_hash,
      sourceHashes,
      nodeCount: nodes.size,
      edgeCount: edgeList.length,
      nodesByType: countBy([...nodes.values()], 'type'),
      edgesByRel: countBy(edgeList, 'rel'),
      freshness: metaRow.freshness,
      lastReconciledAt: metaRow.last_reconciled_at,
    } : null;

    return { nodes, edges: edgeList, out, in: inc, meta, exists: !!metaRow };
  });
}

// Single-row incremental ops (outbox apply, reconciliation diff-apply). Each
// opens its own connection; batch callers (outbox.mjs) pass an already-open
// db instead so a whole batch commits in one transaction.

export function upsertNode(db, workspace, node, { ts = nowIso() } = {}) {
  const existing = db.prepare('SELECT attrs, version, provenance_sources FROM construct_graph_nodes WHERE workspace = :workspace AND id = :id')
    .get({ ':workspace': workspace, ':id': node.id });
  const prevAttrs = existing ? JSON.parse(existing.attrs || '{}') : {};
  const mergedAttrs = { ...prevAttrs, ...(node.attrs || {}) };
  const version = existing ? existing.version + 1 : 1;
  const prevSources = existing ? JSON.parse(existing.provenance_sources || '[]') : [];
  const sources = node.source ? [...new Set([...prevSources, node.source])] : prevSources;

  db.prepare(`INSERT INTO construct_graph_nodes
      (id, workspace, node_type, name, version, attrs, provenance_sources, first_observed, last_verified)
    VALUES (:id, :workspace, :node_type, :name, :version, :attrs, :sources, :ts, :ts)
    ON CONFLICT(workspace, id) DO UPDATE SET
      node_type = excluded.node_type, name = excluded.name, version = excluded.version,
      attrs = excluded.attrs, provenance_sources = excluded.provenance_sources, last_verified = excluded.last_verified`)
    .run({
      ':id': node.id, ':workspace': workspace, ':node_type': node.type, ':name': node.name ?? node.id,
      ':version': version, ':attrs': JSON.stringify(mergedAttrs), ':sources': JSON.stringify(sources), ':ts': ts,
    });
  return { key: node.id, created: !existing };
}

export function deleteNode(db, workspace, nodeId) {
  db.prepare(`UPDATE construct_graph_nodes SET lifecycle = 'deleted', last_verified = :ts WHERE workspace = :workspace AND id = :id`)
    .run({ ':workspace': workspace, ':id': nodeId, ':ts': nowIso() });
  return { key: nodeId };
}

export function upsertEdge(db, workspace, edge, { ts = nowIso() } = {}) {
  const existing = db.prepare('SELECT weight, provenance_sources FROM construct_graph_edges WHERE workspace = :workspace AND from_id = :from AND rel = :rel AND to_id = :to')
    .get({ ':workspace': workspace, ':from': edge.from, ':rel': edge.rel, ':to': edge.to });
  const prevWeight = existing ? existing.weight : 0;
  const weight = prevWeight + (edge.weight || 1);
  const prevSources = existing ? JSON.parse(existing.provenance_sources || '[]') : [];
  const sources = edge.source ? [...new Set([...prevSources, edge.source])] : (edge.sources ? [...new Set([...prevSources, ...edge.sources])] : prevSources);

  db.prepare(`INSERT INTO construct_graph_edges
      (workspace, from_id, rel, to_id, weight, inferred, provenance_sources, first_observed, last_verified)
    VALUES (:workspace, :from, :rel, :to, :weight, :inferred, :sources, :ts, :ts)
    ON CONFLICT(workspace, from_id, rel, to_id) DO UPDATE SET
      weight = excluded.weight, inferred = excluded.inferred, provenance_sources = excluded.provenance_sources, last_verified = excluded.last_verified`)
    .run({
      ':workspace': workspace, ':from': edge.from, ':rel': edge.rel, ':to': edge.to,
      ':weight': weight, ':inferred': isInferredSources(sources) ? 1 : 0, ':sources': JSON.stringify(sources), ':ts': ts,
    });
  return { key: `${edge.from}|${edge.rel}|${edge.to}`, created: !existing };
}

export function deleteEdge(db, workspace, edge) {
  db.prepare(`UPDATE construct_graph_edges SET state = 'superseded', last_verified = :ts
    WHERE workspace = :workspace AND from_id = :from AND rel = :rel AND to_id = :to`)
    .run({ ':workspace': workspace, ':from': edge.from, ':rel': edge.rel, ':to': edge.to, ':ts': nowIso() });
  return { key: `${edge.from}|${edge.rel}|${edge.to}` };
}

export function readSourceHashes(db, workspace) {
  const rows = db.prepare('SELECT source_name, hash FROM construct_graph_source_hash WHERE workspace = :workspace').all({ ':workspace': workspace });
  return Object.fromEntries(rows.map((r) => [r.source_name, r.hash]));
}

export function writeSourceHash(db, workspace, sourceName, hash) {
  db.prepare(`INSERT INTO construct_graph_source_hash (workspace, source_name, hash, hashed_at)
    VALUES (:workspace, :source_name, :hash, :now)
    ON CONFLICT(workspace, source_name) DO UPDATE SET hash = excluded.hash, hashed_at = excluded.hashed_at`)
    .run({ ':workspace': workspace, ':source_name': sourceName, ':hash': hash, ':now': nowIso() });
}

export function readMeta(db, workspace) {
  return db.prepare('SELECT * FROM construct_graph_meta WHERE workspace = :workspace').get({ ':workspace': workspace }) || null;
}

export function setFreshness(db, workspace, freshness, { lastReconciledAt } = {}) {
  db.prepare(`UPDATE construct_graph_meta SET freshness = :freshness${lastReconciledAt ? ', last_reconciled_at = :lastReconciledAt' : ''} WHERE workspace = :workspace`)
    .run(lastReconciledAt ? { ':freshness': freshness, ':workspace': workspace, ':lastReconciledAt': lastReconciledAt } : { ':freshness': freshness, ':workspace': workspace });
}
