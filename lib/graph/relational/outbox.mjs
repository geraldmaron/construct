/**
 * lib/graph/relational/outbox.mjs — transactional outbox + incremental
 * applier (design doc §4, docs/notes/research/workspace-control-plane/
 * synthesis/graph-store-design.md).
 *
 * enqueueOutboxEvent appends a pending row describing a graph delta
 * (node_upsert/node_delete/edge_upsert/edge_delete/source_rehash). drainOutbox
 * claims pending/failed rows in commit order and applies each payload via the
 * same upsert/delete helpers a full rebuild would produce (sqlite-store.mjs:
 * attrs merged last-write-wins, weight summed, sources unioned — identical to
 * lib/graph/normalize.mjs), appends the applied outbox_id to
 * construct_graph_applied_log, and marks the row applied, all in one
 * transaction per row. A row that still fails past max_attempts moves to
 * dead_letter — a trust-loss signal (design doc §5): the reconciliation
 * decision (reconcile.mjs) reads it and forces a full rebuild rather than
 * trusting incremental state.
 */

import { withGraphDb } from './sqlite-db.mjs';
import { resolveGraphWorkspace } from './workspace.mjs';
import { upsertNode, upsertEdge, deleteNode, deleteEdge, writeSourceHash, setFreshness } from './sqlite-store.mjs';

function nowIso() { return new Date().toISOString(); }

/**
 * @param {string} rootDir
 * @param {{ eventType: 'node_upsert'|'node_delete'|'edge_upsert'|'edge_delete'|'source_rehash', payload: object, origin: string, declared?: boolean }} event
 * @returns {number} outbox_id
 */
export function enqueueOutboxEvent(rootDir, { eventType, payload, origin, declared = false }) {
  const workspace = resolveGraphWorkspace(rootDir);
  return withGraphDb(rootDir, (db) => {
    let outboxId;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`INSERT INTO construct_graph_outbox (workspace, event_type, payload, origin, declared)
        VALUES (:workspace, :event_type, :payload, :origin, :declared)`)
        .run({ ':workspace': workspace, ':event_type': eventType, ':payload': JSON.stringify(payload), ':origin': origin, ':declared': declared ? 1 : 0 });
      outboxId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
      db.prepare(`UPDATE construct_graph_meta SET freshness = 'incremental_dirty' WHERE workspace = :workspace AND freshness = 'fresh'`)
        .run({ ':workspace': workspace });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return outboxId;
  });
}

function nextSeq(db, workspace) {
  const row = db.prepare('SELECT MAX(seq) AS maxSeq FROM construct_graph_applied_log WHERE workspace = :workspace').get({ ':workspace': workspace });
  return (row?.maxSeq || 0) + 1;
}

function applyEvent(db, workspace, row) {
  const payload = JSON.parse(row.payload);
  switch (row.event_type) {
    case 'node_upsert': return upsertNode(db, workspace, payload);
    case 'node_delete': return deleteNode(db, workspace, payload.id);
    case 'edge_upsert': return upsertEdge(db, workspace, payload);
    case 'edge_delete': return deleteEdge(db, workspace, payload);
    case 'source_rehash': writeSourceHash(db, workspace, payload.sourceName, payload.hash); return { key: payload.sourceName };
    default: throw new Error(`unknown outbox event_type: ${row.event_type}`);
  }
}

/**
 * Drain pending/failed outbox rows in commit order, applying each to the
 * node/edge tables (one transaction per row so a partial-batch crash only
 * loses progress on the row in flight, never corrupts an already-applied
 * one).
 *
 * @returns {{ applied: number, failed: number, deadLettered: number, appliedIds: number[] }}
 */
export function drainOutbox(rootDir, { batchSize = 100 } = {}) {
  const workspace = resolveGraphWorkspace(rootDir);
  return withGraphDb(rootDir, (db) => {
    const rows = db.prepare(`SELECT outbox_id, event_type, payload, origin, declared, attempt, max_attempts
      FROM construct_graph_outbox WHERE workspace = :workspace AND status IN ('pending','failed')
      ORDER BY outbox_id LIMIT :batchSize`).all({ ':workspace': workspace, ':batchSize': batchSize });

    let applied = 0;
    let failed = 0;
    let deadLettered = 0;
    const appliedIds = [];

    for (const row of rows) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const { key } = applyEvent(db, workspace, row);
        const seq = nextSeq(db, workspace);
        db.prepare(`INSERT INTO construct_graph_applied_log (workspace, seq, event_type, node_or_edge_key)
          VALUES (:workspace, :seq, :event_type, :key)`).run({ ':workspace': workspace, ':seq': seq, ':event_type': row.event_type, ':key': key });
        db.prepare(`UPDATE construct_graph_outbox SET status = 'applied', applied_at = :now WHERE outbox_id = :id`)
          .run({ ':now': nowIso(), ':id': row.outbox_id });
        db.exec('COMMIT');
        applied++;
        appliedIds.push(row.outbox_id);
      } catch (err) {
        db.exec('ROLLBACK');
        const attempt = row.attempt + 1;
        const status = attempt >= row.max_attempts ? 'dead_letter' : 'failed';
        db.prepare(`UPDATE construct_graph_outbox SET status = :status, attempt = :attempt, last_error = :err WHERE outbox_id = :id`)
          .run({ ':status': status, ':attempt': attempt, ':err': String(err?.message || err), ':id': row.outbox_id });
        if (status === 'dead_letter') deadLettered++; else failed++;
      }
    }

    const stillOutstanding = db.prepare(`SELECT COUNT(*) AS n FROM construct_graph_outbox
      WHERE workspace = :workspace AND status IN ('pending','failed','dead_letter')`).get({ ':workspace': workspace }).n;

    if (deadLettered > 0) setFreshness(db, workspace, 'suspect');
    else if (stillOutstanding === 0) setFreshness(db, workspace, 'fresh');

    return { applied, failed, deadLettered, appliedIds };
  });
}

/**
 * Outbox row counts by status, for `construct graph update --json` and the
 * reconciliation trust decision.
 */
export function outboxState(rootDir) {
  const workspace = resolveGraphWorkspace(rootDir);
  return withGraphDb(rootDir, (db) => {
    const counts = db.prepare(`SELECT status, COUNT(*) AS n FROM construct_graph_outbox WHERE workspace = :workspace GROUP BY status`).all({ ':workspace': workspace });
    const byStatus = Object.fromEntries(counts.map((r) => [r.status, r.n]));
    return {
      pending: byStatus.pending || 0,
      applying: byStatus.applying || 0,
      applied: byStatus.applied || 0,
      failed: byStatus.failed || 0,
      deadLetter: byStatus.dead_letter || 0,
    };
  });
}

/**
 * The applied-log seq gap check (design doc §5, queries.sql "applied-log gap
 * check"): a gap between count(*) and the observed seq range means an event
 * was lost.
 */
export function appliedLogGap(rootDir) {
  const workspace = resolveGraphWorkspace(rootDir);
  return withGraphDb(rootDir, (db) => {
    const row = db.prepare(`SELECT MIN(seq) AS minSeq, MAX(seq) AS maxSeq, COUNT(*) AS appliedCount
      FROM construct_graph_applied_log WHERE workspace = :workspace`).get({ ':workspace': workspace });
    if (!row || row.appliedCount === 0) return { hasGap: false, appliedCount: 0 };
    const expectedCount = row.maxSeq - row.minSeq + 1;
    return { hasGap: expectedCount !== row.appliedCount, appliedCount: row.appliedCount, minSeq: row.minSeq, maxSeq: row.maxSeq };
  });
}
