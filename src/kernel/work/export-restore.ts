import { type Entity, type Relation, listRelations, getEntity, addEntity, validateRelationEndpoints } from '../state/graph.ts';
import { parseJson, toJson } from '../state/rows.ts';
import { type StateStore } from '../state/open.ts';
import { type Row, getWork, TERMINAL, type WorkItem, type WorkDepKind, recordEvent } from './helpers.ts';
import { addWorkDependency } from './create-update.ts';

export interface WorkExport {
  readonly format: 'construct-work-export';
  readonly formatVersion: 1;
  readonly exportedAt: string;
  readonly projectId: string | null;
  readonly work: readonly unknown[];
  readonly dependencies: readonly unknown[];
  readonly events: readonly unknown[];
  readonly legacyIds: readonly unknown[];
  /** Durable work identity and its reason links; never permissions or live ownership. */
  readonly graph?: { readonly entities: readonly Entity[]; readonly reasons: readonly Relation[] };
}

/** Legacy claim events may contain a token; durable history never carries it. */
function durableEventPayload(json: string | null): unknown {
  const payload = parseJson(json);
  if (!payload || typeof payload !== 'object' || !('token' in payload)) return payload;
  const { token: _token, ...rest } = payload as Record<string, unknown>;
  return rest;
}

export function exportWork(store: StateStore, at: string, projectId: string | null): WorkExport {
  const workEntities = (
    store.db.prepare('SELECT entity_id FROM work_items WHERE entity_id IS NOT NULL').all() as Array<{ entity_id: string }>
  ).map((r) => r.entity_id);
  const reasons = workEntities.flatMap((id) =>
    listRelations(store, { fromId: id }).filter((r) => r.kind === 'implements' || r.kind === 'contributes_to'),
  );
  const entities = [...new Set([...workEntities, ...reasons.map((r) => r.toId)])]
    .map((id) => getEntity(store, id))
    .filter((e): e is Entity => e !== null);
  return {
    format: 'construct-work-export',
    formatVersion: 1,
    exportedAt: at,
    projectId,
    graph: { entities, reasons },
    // A snapshot is shared and kept; a live claim's secret never goes into one.
    work: (store.db.prepare('SELECT * FROM work_items ORDER BY created_at, id').all() as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      claim_token: null,
    })),
    dependencies: store.db.prepare('SELECT * FROM work_dependencies ORDER BY created_at, id').all(),
    // Claim events written before tokens were secrets carry the token in their
    // payload; a snapshot keeps the event and drops the token.
    events: (
      store.db.prepare('SELECT work_id, at, kind, actor, expected_revision, payload_json FROM work_events ORDER BY id').all() as Array<{
        payload_json: string | null;
      }>
    ).map((row) => {
      return { ...row, payload_json: toJson(durableEventPayload(row.payload_json)) };
    }),
    legacyIds: store.db.prepare('SELECT legacy_id, work_id, source, created_at FROM work_legacy_ids ORDER BY created_at').all(),
  };
}

export interface RestoreReport {
  readonly imported: number;
  readonly skipped: number;
  readonly conflicts: readonly string[];
}

/**
 * Restore durable work and decisions. Grants, credentials, and live lease
 * ownership are never restored.
 */
export function restoreWork(store: StateStore, dump: WorkExport, at: string, projectId: string | null = null): RestoreReport {
  if (dump.format !== 'construct-work-export' || dump.formatVersion !== 1) {
    throw new Error('this is not a construct-work-export v1 snapshot');
  }
  if (projectId !== null && dump.projectId !== null && dump.projectId !== projectId) {
    throw new Error(
      `this snapshot was taken from project ${dump.projectId}; this project is ${projectId}. Work moves between separate projects as new items, not as a restore.`,
    );
  }
  const conflicts: string[] = [];
  let imported = 0;
  let skipped = 0;
  return store.transaction(() => {
    const inserted = new Map<string, Row>();
    for (const raw of dump.work) {
      const row = raw as Row;
      const existing = getWork(store, row.id);
      if (existing) {
        skipped += 1;
        if (existing.revision !== row.revision)
          conflicts.push(`${row.id}: live revision ${String(existing.revision)} vs snapshot ${String(row.revision)}`);
        continue;
      }
      store.db
        .prepare(
          `INSERT INTO work_items
             (id, kind, title, description, status, scope_json, premises_json, acceptance_json, risk_json,
              entity_id, parent_id, superseded_by, revision, created_at, updated_at, completed_at, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.id,
          row.kind,
          row.title,
          row.description,
          TERMINAL.includes(row.status) ? row.status : row.status === 'claimed' || row.status === 'in_progress' ? 'open' : row.status,
          row.scope_json,
          row.premises_json,
          row.acceptance_json,
          row.risk_json,
          row.revision,
          row.created_at,
          at,
          row.completed_at,
          row.reason,
        );
      inserted.set(row.id, row);
      imported += 1;
    }
    // Restore only the graph closure needed by imported work. Other snapshot
    // entities cannot introduce unrelated project state or execution authority.
    const workEntityIds = new Set([...inserted.values()].map((row) => row.entity_id).filter((id): id is string => id !== null));
    const reasons = (dump.graph?.reasons ?? []).filter((r) => workEntityIds.has(r.fromId));
    if (reasons.some((r) => r.kind !== 'implements' && r.kind !== 'contributes_to'))
      throw new Error('work restore accepts only work reason relations');
    const requiredEntities = new Set([...workEntityIds, ...reasons.map((r) => r.toId)]);
    for (const entity of dump.graph?.entities ?? []) {
      if (!requiredEntities.has(entity.id)) continue;
      const existing = getEntity(store, entity.id);
      if (existing) {
        if (existing.kind !== entity.kind || existing.externalRef !== entity.externalRef)
          throw new Error(`entity ${entity.id} conflicts with its live identity`);
        if (
          existing.name !== entity.name ||
          existing.status !== entity.status ||
          JSON.stringify(existing.attributes) !== JSON.stringify(entity.attributes)
        )
          conflicts.push(`${entity.id}: live graph entity differs from snapshot; kept live`);
        continue;
      }
      addEntity(store, {
        id: entity.id,
        kind: entity.kind,
        name: entity.name,
        externalRef: entity.externalRef ?? undefined,
        attributes: entity.attributes,
        at: entity.createdAt,
      });
      store.db.prepare('UPDATE entities SET status = ?, updated_at = ? WHERE id = ?').run(entity.status, entity.updatedAt, entity.id);
    }
    for (const row of inserted.values()) {
      const entityId = row.entity_id ?? `ent-${row.id}`;
      let entity = getEntity(store, entityId);
      if (!entity && (!dump.graph || row.entity_id === null))
        entity = addEntity(store, { id: entityId, kind: 'work_item', name: row.title, externalRef: `work:${row.id}`, at: row.created_at });
      if (!entity || entity.kind !== 'work_item' || entity.externalRef !== `work:${row.id}`)
        throw new Error(`snapshot work ${row.id} has no matching work entity`);
      store.db.prepare('UPDATE work_items SET entity_id = ? WHERE id = ?').run(entityId, row.id);
    }
    for (const relation of reasons) {
      const from = getEntity(store, relation.fromId);
      const to = getEntity(store, relation.toId);
      if (!from || !to) throw new Error(`snapshot reason ${relation.id} has a missing entity`);
      validateRelationEndpoints(relation.kind, from, to);
      const existing = store.db
        .prepare('SELECT * FROM relations WHERE id = ? OR (kind = ? AND from_id = ? AND to_id = ?)')
        .get(relation.id, relation.kind, relation.fromId, relation.toId) as
        | { kind: string; from_id: string; to_id: string; status: string; basis: string; confidence: number; source_id: string | null }
        | undefined;
      if (existing) {
        if (existing.kind !== relation.kind || existing.from_id !== relation.fromId || existing.to_id !== relation.toId)
          throw new Error(`relation ${relation.id} conflicts with its live identity`);
        if (
          existing.status !== relation.status ||
          existing.basis !== relation.basis ||
          existing.confidence !== relation.confidence ||
          existing.source_id !== relation.sourceId
        )
          conflicts.push(`${relation.id}: live reason evidence differs from snapshot; kept live`);
        continue;
      }
      // Preserve recorded evidence basis and status. No source identity or
      // permission is fabricated; a missing provenance source fails atomically.
      store.db
        .prepare(
          'INSERT INTO relations (id, kind, from_id, to_id, basis, confidence, source_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          relation.id,
          relation.kind,
          relation.fromId,
          relation.toId,
          relation.basis,
          relation.confidence,
          relation.sourceId,
          relation.status,
          relation.createdAt,
        );
    }
    // Creation order is not relationship order: valid reparenting and
    // supersession may point at identities created later. Keep FK enforcement
    // active and restore relationships only after every identity exists.
    for (const row of inserted.values()) {
      store.db.prepare('UPDATE work_items SET parent_id = ?, superseded_by = ? WHERE id = ?').run(row.parent_id, row.superseded_by, row.id);
    }
    for (const row of inserted.values()) {
      const seen = new Set<string>();
      for (let work: WorkItem | null = getWork(store, row.id); work; work = work.parentId ? getWork(store, work.parentId) : null) {
        if (seen.has(work.id)) throw new Error(`restoring ${row.id} would cycle its parent chain`);
        seen.add(work.id);
      }
    }
    for (const raw of dump.dependencies) {
      const d = raw as { id: string; from_id: string; to_id: string; kind: WorkDepKind; created_at: string };
      if (!inserted.has(d.from_id)) continue;
      const existing = store.db
        .prepare('SELECT from_id, to_id, kind FROM work_dependencies WHERE id = ? OR (from_id = ? AND to_id = ? AND kind = ?)')
        .get(d.id, d.from_id, d.to_id, d.kind) as { from_id: string; to_id: string; kind: string } | undefined;
      if (existing) {
        if (existing.from_id !== d.from_id || existing.to_id !== d.to_id || existing.kind !== d.kind)
          throw new Error(`dependency ${d.id} conflicts with its live identity`);
        continue;
      }
      addWorkDependency(store, { id: d.id, fromId: d.from_id, toId: d.to_id, kind: d.kind, at: d.created_at });
    }
    // Restore history only for newly imported identities. Repeated restores
    // and revision conflicts must not append another item's snapshot history.
    for (const raw of dump.events) {
      const event = raw as {
        work_id: string;
        at: string;
        kind: string;
        actor: string | null;
        expected_revision: number | null;
        payload_json: string;
      };
      if (!inserted.has(event.work_id)) continue;
      const payload = durableEventPayload(event.payload_json);
      if (
        !dump.graph &&
        event.kind === 'admitted' &&
        payload &&
        typeof payload === 'object' &&
        (payload as { basis?: string }).basis === 'serves'
      )
        conflicts.push(`${event.work_id}: legacy snapshot has no reason graph; relink the work reason`);
      recordEvent(store, event.work_id, event.at, event.kind, event.actor, event.expected_revision, payload);
    }
    for (const raw of dump.legacyIds) {
      const l = raw as { legacy_id: string; work_id: string; source: string; created_at: string };
      if (!inserted.has(l.work_id)) continue;
      const existing = store.db.prepare('SELECT work_id FROM work_legacy_ids WHERE legacy_id = ?').get(l.legacy_id) as
        | { work_id: string }
        | undefined;
      if (existing && existing.work_id !== l.work_id)
        conflicts.push(`${l.legacy_id}: live legacy mapping differs from snapshot; kept live`);
      store.db
        .prepare(`INSERT OR IGNORE INTO work_legacy_ids (legacy_id, work_id, source, created_at) VALUES (?, ?, ?, ?)`)
        .run(l.legacy_id, l.work_id, l.source, l.created_at);
    }
    return { imported, skipped, conflicts };
  });
}
