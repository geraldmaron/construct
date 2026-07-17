/**
 * lib/graph/relational/postgres-store.mjs — Postgres backend for the
 * relational graph store.
 *
 * STRUCTURAL, NOT LIVE-VERIFIED: no Postgres instance was reachable in the
 * construct-b0nny.3 build environment, so this class is exercised only by
 * tests/relational/postgres-graph-store.test.mjs's bindNamedParams unit
 * coverage (pure JS, no network) — every method below that touches `this.sql`
 * is structural correctness only until a real DATABASE_URL round-trip runs it
 * (tracked as a gap in the bead's closing report, not silently claimed done).
 *
 * Mirrors lib/orchestration/run-store-postgres.mjs's shape: a class over the
 * porsager/postgres tagged-template client from lib/storage/backend.mjs's
 * createSqlClient. Schema migrations live at
 * lib/db/migrations/007_graph_foundation.sql, applied through the existing
 * lib/db/migrate.mjs runner (one construct_schema_migrations ledger shared
 * with orchestration's own migrations, one Postgres database).
 *
 * The recursive-CTE query surface (lib/graph/relational/queries.mjs) is
 * reused verbatim — bindNamedParams rewrites the `:name` placeholders
 * node:sqlite binds natively into $1..$n positional params for
 * sql.unsafe(text, values), so cross-backend parity is byte-identical query
 * text, not a re-derived Postgres-flavored rewrite (design doc §4, day-one
 * milestone: "equivalent results on SQLite and Postgres").
 */

import { CURRENT_SCHEMA_VERSION } from './schema-version.mjs';
import { normalizeNodes, normalizeEdges, countBy, isInferredSources } from '../normalize.mjs';

/**
 * Rewrite `:name` named-parameter placeholders (as bound by node:sqlite) into
 * `$1..$n` positional placeholders for `sql.unsafe(text, values)`. A name
 * repeated in the template reuses its earlier `$n` slot rather than
 * duplicating the value, matching how a real driver would deduplicate a
 * named bind.
 *
 * @param {string} sqlText
 * @param {Record<string,*>} paramsObject — keys include the leading colon
 *   (":workspace"), matching the object shape node:sqlite's `.all()` takes.
 * @returns {{ text: string, values: any[] }}
 */
export function bindNamedParams(sqlText, paramsObject) {
  const order = [];
  const slotByName = new Map();
  const text = sqlText.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    const key = `:${name}`;
    if (!slotByName.has(key)) {
      slotByName.set(key, order.length + 1);
      order.push(paramsObject[key]);
    }
    return `$${slotByName.get(key)}`;
  });
  return { text, values: order };
}

export class PostgresGraphStore {
  constructor({ sql, workspace } = {}) {
    if (!sql) throw new Error('PostgresGraphStore: sql client is required');
    if (!workspace) throw new Error('PostgresGraphStore: workspace is required');
    this.sql = sql;
    this.workspace = workspace;
  }

  async ensureSchema() {
    const { applyMigrations } = await import('../../db/migrate.mjs');
    await applyMigrations(this.sql);
  }

  /** Full-rebuild write ("build"), mirroring sqlite-store.mjs's writeGraph. */
  async writeGraph({ nodes = [], edges = [], generatedAt = null, sourceHash = null, sourceHashes = null }) {
    const normNodes = normalizeNodes(nodes);
    const normEdges = normalizeEdges(edges);
    const { workspace, sql } = this;

    await sql.begin(async (tx) => {
      await tx`DELETE FROM construct_graph_nodes WHERE workspace = ${workspace}`;
      await tx`DELETE FROM construct_graph_edges WHERE workspace = ${workspace}`;
      for (const n of normNodes) {
        await tx`INSERT INTO construct_graph_nodes (id, workspace, node_type, name, version, attrs, provenance_sources)
          VALUES (${n.id}, ${workspace}, ${n.type}, ${n.name ?? n.id}, 1, ${tx.json(n.attrs || {})}, ${tx.json([])})`;
      }
      for (const e of normEdges) {
        await tx`INSERT INTO construct_graph_edges (workspace, from_id, rel, to_id, weight, inferred, provenance_sources)
          VALUES (${workspace}, ${e.from}, ${e.rel}, ${e.to}, ${e.weight || 1}, ${isInferredSources(e.sources)}, ${tx.json(e.sources || [])})`;
      }
      await tx`INSERT INTO construct_graph_meta (workspace, schema_version, generated_at, source_hash, node_count, edge_count, last_reconciled_at, freshness)
        VALUES (${workspace}, ${CURRENT_SCHEMA_VERSION}, ${generatedAt}, ${sourceHash}, ${normNodes.length}, ${normEdges.length}, now(), 'fresh')
        ON CONFLICT (workspace) DO UPDATE SET
          schema_version = EXCLUDED.schema_version, generated_at = EXCLUDED.generated_at, source_hash = EXCLUDED.source_hash,
          node_count = EXCLUDED.node_count, edge_count = EXCLUDED.edge_count,
          last_reconciled_at = EXCLUDED.last_reconciled_at, freshness = 'fresh'`;
      if (sourceHashes) {
        for (const [name, hash] of Object.entries(sourceHashes)) {
          await tx`INSERT INTO construct_graph_source_hash (workspace, source_name, hash)
            VALUES (${workspace}, ${name}, ${hash})
            ON CONFLICT (workspace, source_name) DO UPDATE SET hash = EXCLUDED.hash, hashed_at = now()`;
        }
      }
    });

    return { nodeCount: normNodes.length, edgeCount: normEdges.length };
  }

  /** Read the whole workspace graph into the legacy in-memory shape. */
  async loadGraph() {
    const { workspace, sql } = this;
    const nodeRows = await sql`SELECT * FROM construct_graph_nodes WHERE workspace = ${workspace} ORDER BY id`;
    const edgeRows = await sql`SELECT * FROM construct_graph_edges WHERE workspace = ${workspace} ORDER BY from_id, rel, to_id`;
    const metaRows = await sql`SELECT * FROM construct_graph_meta WHERE workspace = ${workspace}`;
    const hashRows = await sql`SELECT source_name, hash FROM construct_graph_source_hash WHERE workspace = ${workspace}`;

    const nodes = new Map();
    for (const r of nodeRows) {
      nodes.set(r.id, { id: r.id, type: r.node_type, name: r.name, attrs: r.attrs || {}, lifecycle: r.lifecycle, owner: r.owner, version: r.version });
    }
    const edgeList = edgeRows.map((r) => ({
      from: r.from_id, to: r.to_id, rel: r.rel, weight: r.weight,
      sources: r.provenance_sources || [], inferred: !!r.inferred, state: r.state,
    }));
    const out = new Map();
    const inc = new Map();
    for (const e of edgeList) {
      if (!out.has(e.from)) out.set(e.from, []);
      if (!inc.has(e.to)) inc.set(e.to, []);
      out.get(e.from).push(e);
      inc.get(e.to).push(e);
    }

    const metaRow = metaRows[0];
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
  }

  async enqueueOutboxEvent({ eventType, payload, origin, declared = false }) {
    const rows = await this.sql`INSERT INTO construct_graph_outbox (workspace, event_type, payload, origin, declared)
      VALUES (${this.workspace}, ${eventType}, ${this.sql.json(payload)}, ${origin}, ${declared})
      RETURNING outbox_id`;
    return rows[0]?.outbox_id;
  }

  /** Run one of the portable query templates (queries.mjs) via bindNamedParams. */
  async runQuery(sqlTemplate, paramsObject) {
    const { text, values } = bindNamedParams(sqlTemplate, paramsObject);
    return this.sql.unsafe(text, values);
  }
}
