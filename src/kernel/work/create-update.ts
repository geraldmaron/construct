import { type StateStore } from '../state/open.ts';
import { requireNonEmpty, requireOneOf, requireInstant, toJson, parseJson } from '../state/rows.ts';
import { type Entity, addEntity } from '../state/graph.ts';
import { appendActivity } from '../state/activity.ts';
import {
  type WorkKind,
  type WorkStatus,
  type WorkItem,
  WORK_KINDS,
  WORK_STATUSES,
  getWork,
  type Row,
  recordEvent,
  toWork,
  type WorkDepKind,
  WORK_DEP_KINDS,
  wouldCycle,
  isStale,
  TERMINAL,
  staleMark,
} from './helpers.ts';

export interface CreateWorkInput {
  readonly id: string;
  readonly kind: WorkKind;
  readonly title: string;
  readonly description: string;
  readonly parentId?: string;
  readonly scope?: unknown;
  readonly premises?: unknown;
  readonly acceptance?: unknown;
  readonly risk?: unknown;
  readonly status?: Exclude<WorkStatus, 'completed' | 'cancelled' | 'superseded' | 'historical'>;
  readonly at: string;
  readonly actor?: string;
}

export function createWork(store: StateStore, input: CreateWorkInput): WorkItem {
  requireNonEmpty(input.id, 'work.id');
  requireOneOf(input.kind, WORK_KINDS, 'work.kind');
  requireNonEmpty(input.title, 'work.title');
  requireInstant(input.at, 'work.at');
  const status = input.status ?? 'open';
  requireOneOf(status, WORK_STATUSES, 'work.status');
  return store.transaction(() => {
    if (input.parentId) {
      const parent = getWork(store, input.parentId);
      if (!parent) throw new Error(`no parent work ${input.parentId}`);
    }
    const entity: Entity = addEntity(store, {
      id: `ent-${input.id}`,
      kind: 'work_item',
      name: input.title,
      externalRef: `work:${input.id}`,
      at: input.at,
    });
    const row = store.db
      .prepare(
        `INSERT INTO work_items
           (id, kind, title, description, status, scope_json, premises_json, acceptance_json, risk_json,
            entity_id, parent_id, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING *`,
      )
      .get(
        input.id,
        input.kind,
        input.title,
        input.description,
        status,
        input.scope === undefined ? null : toJson(input.scope),
        input.premises === undefined ? null : toJson(input.premises),
        input.acceptance === undefined ? null : toJson(input.acceptance),
        input.risk === undefined ? null : toJson(input.risk),
        entity.id,
        input.parentId ?? null,
        input.at,
        input.at,
      ) as unknown as Row;
    recordEvent(store, input.id, input.at, 'created', input.actor ?? null, 1, { kind: input.kind, status });
    appendActivity(store, { at: input.at, kind: 'work.created', actor: input.actor, payload: { workId: input.id } });
    return toWork(row);
  });
}

export function bindLegacyId(
  store: StateStore,
  input: { readonly legacyId: string; readonly workId: string; readonly source: string; readonly at: string },
): void {
  requireNonEmpty(input.legacyId, 'legacy.id');
  store.db
    .prepare(
      `INSERT INTO work_legacy_ids (legacy_id, work_id, source, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(legacy_id) DO NOTHING`,
    )
    .run(input.legacyId, input.workId, input.source, input.at);
}

export function addWorkDependency(
  store: StateStore,
  input: { readonly id: string; readonly fromId: string; readonly toId: string; readonly kind: WorkDepKind; readonly at: string },
): void {
  requireOneOf(input.kind, WORK_DEP_KINDS, 'work.dep.kind');
  requireInstant(input.at, 'work.dep.at');
  if (input.fromId === input.toId) throw new Error('a work item cannot depend on itself');
  if (!getWork(store, input.fromId)) throw new Error(`no work ${input.fromId}`);
  if (!getWork(store, input.toId)) throw new Error(`no work ${input.toId}`);
  if (wouldCycle(store, input.fromId, input.toId, input.kind)) {
    throw new Error(`adding ${input.kind} from ${input.fromId} to ${input.toId} would cycle`);
  }
  store.db
    .prepare(`INSERT INTO work_dependencies (id, from_id, to_id, kind, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(input.id, input.fromId, input.toId, input.kind, input.at);
}

/** Remove one dependency; true when there was one to remove. */
export function removeWorkDependency(
  store: StateStore,
  input: { readonly fromId: string; readonly toId: string; readonly kind: WorkDepKind },
): boolean {
  requireOneOf(input.kind, WORK_DEP_KINDS, 'work.dep.kind');
  return (
    store.db.prepare('DELETE FROM work_dependencies WHERE from_id = ? AND to_id = ? AND kind = ?').run(input.fromId, input.toId, input.kind)
      .changes > 0
  );
}

/**
 * Clear a stale-premise mark after the work was checked against what changed.
 * The reason says what was checked; it is the only way the mark comes off.
 */
export function requalifyWork(
  store: StateStore,
  input: { readonly id: string; readonly reason: string; readonly at: string; readonly actor?: string },
): WorkItem {
  requireInstant(input.at, 'work.at');
  requireNonEmpty(input.reason, 'work.requalify.reason');
  return store.transaction(() => {
    const current = getWork(store, input.id);
    if (!current) throw new Error(`no work ${input.id}`);
    if (!isStale(current.premises)) throw new Error(`work ${input.id} has no stale premises to requalify`);
    const {
      stale: _stale,
      staleSource,
      staleAt: _staleAt,
      ...rest
    } = current.premises as { stale: boolean; staleSource?: unknown; staleAt?: unknown };
    store.db
      .prepare(
        `UPDATE work_items SET premises_json = ?, status = CASE WHEN status = 'blocked' THEN 'open' ELSE status END, revision = revision + 1, updated_at = ? WHERE id = ?`,
      )
      .run(toJson(rest), input.at, input.id);
    recordEvent(store, input.id, input.at, 'requalified', input.actor ?? null, current.revision + 1, {
      reason: input.reason,
      staleSource: staleSource ?? null,
    });
    return getWork(store, input.id)!;
  });
}

export function markPremisesStale(store: StateStore, sourceId: string, at: string): readonly string[] {
  const rows = store.db
    .prepare("SELECT * FROM work_items WHERE status NOT IN ('completed', 'cancelled', 'superseded', 'historical')")
    .all() as unknown as Row[];
  const affected: string[] = [];
  for (const row of rows) {
    const premises = parseJson(row.premises_json);
    if (!premises || typeof premises !== 'object') continue;
    const sources = (premises as { sources?: unknown }).sources;
    if (!Array.isArray(sources) || !sources.includes(sourceId)) continue;
    const next = { ...(premises as object), stale: true, staleSource: sourceId, staleAt: at };
    store.db
      .prepare(
        "UPDATE work_items SET premises_json = ?, status = CASE WHEN status IN ('ready', 'open') THEN 'blocked' ELSE status END, updated_at = ?, revision = revision + 1 WHERE id = ?",
      )
      .run(toJson(next), at, row.id);
    recordEvent(store, row.id, at, 'premises_stale', null, row.revision + 1, { sourceId });
    affected.push(row.id);
  }
  return affected;
}

export function updateWork(
  store: StateStore,
  input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly at: string;
    readonly actor?: string;
    readonly title?: string;
    readonly description?: string;
    readonly scope?: unknown;
    readonly premises?: unknown;
    readonly acceptance?: unknown;
    readonly risk?: unknown;
    readonly reason?: string;
  },
): WorkItem {
  requireInstant(input.at, 'work.at');
  return store.transaction(() => {
    const current = getWork(store, input.id);
    if (!current) throw new Error(`no work ${input.id}`);
    if (TERMINAL.includes(current.status)) throw new Error(`work ${input.id} is ${current.status}; reopen it before editing`);
    if (current.revision !== input.expectedRevision) {
      throw new Error(`work ${input.id} is at revision ${String(current.revision)}; expected ${String(input.expectedRevision)}`);
    }
    // New premises never clear a stale mark: only requalifying does, with a reason.
    const stale = isStale(current.premises) ? staleMark(current.premises) : null;
    const premises =
      input.premises === undefined || stale === null || typeof input.premises !== 'object' || input.premises === null
        ? input.premises
        : { ...(input.premises as object), ...stale };
    store.db
      .prepare(
        `UPDATE work_items SET
           title = ?, description = ?, scope_json = ?, premises_json = ?, acceptance_json = ?, risk_json = ?,
           reason = COALESCE(?, reason), revision = revision + 1, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.title ?? current.title,
        input.description ?? current.description,
        input.scope === undefined ? (current.scope === null ? null : toJson(current.scope)) : toJson(input.scope),
        premises === undefined ? (current.premises === null ? null : toJson(current.premises)) : toJson(premises),
        input.acceptance === undefined ? (current.acceptance === null ? null : toJson(current.acceptance)) : toJson(input.acceptance),
        input.risk === undefined ? (current.risk === null ? null : toJson(current.risk)) : toJson(input.risk),
        input.reason ?? null,
        input.at,
        input.id,
      );
    recordEvent(store, input.id, input.at, 'updated', input.actor ?? null, current.revision + 1, {
      fields: Object.keys(input).filter((k) => k !== 'id' && k !== 'expectedRevision' && k !== 'at' && k !== 'actor'),
    });
    return getWork(store, input.id)!;
  });
}
