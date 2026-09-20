/**
 * kernel/work/service.ts — the native bounded work ledger.
 *
 * Work items, blocking and informational dependencies, atomic claims with
 * fencing tokens, and versioned export/restore live here. Workflow runs stay
 * in kernel/state/runs.ts; a work item may have many runs without duplicating
 * its business meaning. Readiness is computed from current scope, premises,
 * blocking dependencies, claims, and unresolved blockers — not from a status
 * string alone.
 */

import type { StateStore } from '../state/open.ts';
import { appendActivity } from '../state/activity.ts';
import { parseJson, requireInstant, requireNonEmpty, requireOneOf, toJson } from '../state/rows.ts';
import { addEntity, type Entity } from '../state/graph.ts';

export const WORK_KINDS = ['outcome', 'task', 'defect', 'plan'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

export const WORK_STATUSES = [
  'proposed',
  'open',
  'ready',
  'claimed',
  'in_progress',
  'blocked',
  'completed',
  'cancelled',
  'superseded',
  'historical',
] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export const WORK_DEP_KINDS = ['blocks', 'informs'] as const;
export type WorkDepKind = (typeof WORK_DEP_KINDS)[number];

const TERMINAL: readonly WorkStatus[] = ['completed', 'cancelled', 'superseded', 'historical'];

export interface WorkItem {
  readonly id: string;
  readonly kind: WorkKind;
  readonly title: string;
  readonly description: string;
  readonly status: WorkStatus;
  readonly scope: unknown;
  readonly premises: unknown;
  readonly acceptance: unknown;
  readonly risk: unknown;
  readonly entityId: string | null;
  readonly parentId: string | null;
  readonly supersededBy: string | null;
  readonly revision: number;
  readonly claimOwner: string | null;
  readonly claimToken: string | null;
  readonly claimUntil: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly reason: string | null;
}

interface Row {
  readonly id: string;
  readonly kind: WorkKind;
  readonly title: string;
  readonly description: string;
  readonly status: WorkStatus;
  readonly scope_json: string | null;
  readonly premises_json: string | null;
  readonly acceptance_json: string | null;
  readonly risk_json: string | null;
  readonly entity_id: string | null;
  readonly parent_id: string | null;
  readonly superseded_by: string | null;
  readonly revision: number;
  readonly claim_owner: string | null;
  readonly claim_token: string | null;
  readonly claim_until: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
  readonly reason: string | null;
}

function toWork(row: Row): WorkItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    status: row.status,
    scope: parseJson(row.scope_json),
    premises: parseJson(row.premises_json),
    acceptance: parseJson(row.acceptance_json),
    risk: parseJson(row.risk_json),
    entityId: row.entity_id,
    parentId: row.parent_id,
    supersededBy: row.superseded_by,
    revision: row.revision,
    claimOwner: row.claim_owner,
    claimToken: row.claim_token,
    claimUntil: row.claim_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    reason: row.reason,
  };
}

function recordEvent(
  store: StateStore,
  workId: string,
  at: string,
  kind: string,
  actor: string | null,
  expectedRevision: number | null,
  payload: unknown,
): void {
  store.db
    .prepare(
      `INSERT INTO work_events (work_id, at, kind, actor, expected_revision, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(workId, at, kind, actor, expectedRevision, toJson(payload));
}

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

export function getWork(store: StateStore, id: string): WorkItem | null {
  const row = store.db.prepare('SELECT * FROM work_items WHERE id = ?').get(id) as Row | undefined;
  return row ? toWork(row) : null;
}

export function getWorkByLegacyId(store: StateStore, legacyId: string): WorkItem | null {
  const map = store.db
    .prepare('SELECT work_id FROM work_legacy_ids WHERE legacy_id = ?')
    .get(legacyId) as { work_id: string } | undefined;
  return map ? getWork(store, map.work_id) : null;
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

export interface WorkQuery {
  readonly status?: WorkStatus;
  readonly kind?: WorkKind;
  readonly query?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface WorkPage {
  readonly items: readonly WorkItem[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly truncated: boolean;
}

export function queryWork(store: StateStore, filter: WorkQuery = {}): WorkPage {
  const limit = Math.max(1, Math.min(filter.limit ?? 50, 500));
  const offset = Math.max(0, filter.offset ?? 0);
  const q = filter.query?.trim().toLowerCase() ?? '';
  const rows = store.db
    .prepare(
      `SELECT * FROM work_items
        WHERE (? IS NULL OR status = ?) AND (? IS NULL OR kind = ?)
        ORDER BY updated_at DESC, id`,
    )
    .all(filter.status ?? null, filter.status ?? null, filter.kind ?? null, filter.kind ?? null) as unknown as Row[];
  const matched = q
    ? rows.filter((r) => `${r.id} ${r.title} ${r.description}`.toLowerCase().includes(q))
    : rows;
  const slice = matched.slice(offset, offset + limit);
  return {
    items: slice.map(toWork),
    total: matched.length,
    limit,
    offset,
    truncated: offset + slice.length < matched.length,
  };
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

export interface WorkDep {
  readonly id: string;
  readonly fromId: string;
  readonly toId: string;
  readonly kind: WorkDepKind;
}

export function listWorkDependencies(store: StateStore, workId?: string): WorkDep[] {
  const rows = (
    workId
      ? store.db
          .prepare('SELECT * FROM work_dependencies WHERE from_id = ? OR to_id = ?')
          .all(workId, workId)
      : store.db.prepare('SELECT * FROM work_dependencies').all()
  ) as Array<{ id: string; from_id: string; to_id: string; kind: WorkDepKind }>;
  return rows.map((r) => ({ id: r.id, fromId: r.from_id, toId: r.to_id, kind: r.kind }));
}

function blockingOpen(store: StateStore, workId: string): WorkItem[] {
  const deps = store.db
    .prepare(
      `SELECT w.* FROM work_dependencies d JOIN work_items w ON w.id = d.to_id
        WHERE d.from_id = ? AND d.kind = 'blocks'`,
    )
    .all(workId) as unknown as Row[];
  return deps.map(toWork).filter((w) => !TERMINAL.includes(w.status));
}

function wouldCycle(store: StateStore, fromId: string, toId: string, kind: WorkDepKind): boolean {
  if (kind !== 'blocks') return false;
  const seen = new Set<string>();
  const stack = [toId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === fromId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const next = store.db
      .prepare(`SELECT to_id FROM work_dependencies WHERE from_id = ? AND kind = 'blocks'`)
      .all(id) as Array<{ to_id: string }>;
    for (const n of next) stack.push(n.to_id);
  }
  return false;
}

export interface Readiness {
  readonly ready: boolean;
  readonly blockers: readonly string[];
}

export function readinessOf(store: StateStore, work: WorkItem, at: string): Readiness {
  const blockers: string[] = [];
  if (TERMINAL.includes(work.status)) blockers.push(`status is ${work.status}`);
  if (work.status === 'proposed') blockers.push('still proposed; not admitted');
  const open = blockingOpen(store, work.id);
  for (const b of open) blockers.push(`blocked by ${b.id} (${b.title})`);
  if (work.claimOwner && work.claimUntil && work.claimUntil > at && work.status === 'claimed') {
    blockers.push(`claimed by ${work.claimOwner} until ${work.claimUntil}`);
  }
  const premises = work.premises;
  if (premises && typeof premises === 'object' && premises !== null && 'stale' in premises && (premises as { stale?: boolean }).stale) {
    blockers.push('premises changed; requalify before dispatch');
  }
  return { ready: blockers.length === 0, blockers };
}

export function listReady(store: StateStore, at: string, limit = 50): WorkItem[] {
  const rows = store.db
    .prepare(
      `SELECT * FROM work_items
        WHERE status NOT IN ('completed', 'cancelled', 'superseded', 'historical', 'proposed', 'in_progress', 'claimed')
        ORDER BY updated_at DESC, id`,
    )
    .all() as unknown as Row[];
  const out: WorkItem[] = [];
  for (const row of rows) {
    const w = toWork(row);
    if (w.claimOwner && w.claimUntil && w.claimUntil > at) continue;
    if (readinessOf(store, w, at).ready) out.push(w);
    if (out.length >= limit) break;
  }
  return out;
}

export function markPremisesStale(store: StateStore, sourceId: string, at: string): readonly string[] {
  const rows = store.db.prepare('SELECT * FROM work_items WHERE status NOT IN (\'completed\', \'cancelled\', \'superseded\', \'historical\')').all() as unknown as Row[];
  const affected: string[] = [];
  for (const row of rows) {
    const premises = parseJson(row.premises_json);
    if (!premises || typeof premises !== 'object') continue;
    const sources = (premises as { sources?: unknown }).sources;
    if (!Array.isArray(sources) || !sources.includes(sourceId)) continue;
    const next = { ...(premises as object), stale: true, staleSource: sourceId, staleAt: at };
    store.db
      .prepare('UPDATE work_items SET premises_json = ?, status = CASE WHEN status IN (\'ready\', \'open\') THEN \'blocked\' ELSE status END, updated_at = ?, revision = revision + 1 WHERE id = ?')
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
    if (current.revision !== input.expectedRevision) {
      throw new Error(`work ${input.id} is at revision ${String(current.revision)}; expected ${String(input.expectedRevision)}`);
    }
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
        input.premises === undefined ? (current.premises === null ? null : toJson(current.premises)) : toJson(input.premises),
        input.acceptance === undefined ? (current.acceptance === null ? null : toJson(current.acceptance)) : toJson(input.acceptance),
        input.risk === undefined ? (current.risk === null ? null : toJson(current.risk)) : toJson(input.risk),
        input.reason ?? null,
        input.at,
        input.id,
      );
    recordEvent(store, input.id, input.at, 'updated', input.actor ?? null, current.revision + 1, { fields: Object.keys(input).filter((k) => k !== 'id' && k !== 'expectedRevision' && k !== 'at' && k !== 'actor') });
    return getWork(store, input.id)!;
  });
}

export function claimWork(
  store: StateStore,
  input: { readonly id: string; readonly owner: string; readonly until: string; readonly now: string; readonly expectedRevision?: number },
): WorkItem {
  requireNonEmpty(input.owner, 'work.claim.owner');
  requireInstant(input.until, 'work.claim.until');
  requireInstant(input.now, 'work.claim.now');
  if (input.until <= input.now) throw new Error('claim.until must be after now');
  return store.transaction(() => {
    const current = getWork(store, input.id);
    if (!current) throw new Error(`no work ${input.id}`);
    if (input.expectedRevision !== undefined && current.revision !== input.expectedRevision) {
      throw new Error(`work ${input.id} is at revision ${String(current.revision)}; expected ${String(input.expectedRevision)}`);
    }
    if (TERMINAL.includes(current.status)) throw new Error(`work ${input.id} is ${current.status}`);
    if (current.claimOwner && current.claimUntil && current.claimUntil > input.now && current.claimOwner !== input.owner) {
      throw new Error(`work ${input.id} is claimed by ${current.claimOwner} until ${current.claimUntil}`);
    }
    const ready = readinessOf(store, { ...current, claimOwner: null, claimUntil: null }, input.now);
    if (!ready.ready) throw new Error(`work ${input.id} is not ready: ${ready.blockers.join('; ')}`);
    const token = `${input.owner}:${input.now}:${String(current.revision + 1)}`;
    store.db
      .prepare(
        `UPDATE work_items SET status = 'claimed', claim_owner = ?, claim_token = ?, claim_until = ?,
            revision = revision + 1, updated_at = ?
          WHERE id = ?`,
      )
      .run(input.owner, token, input.until, input.now, input.id);
    recordEvent(store, input.id, input.now, 'claimed', input.owner, current.revision + 1, { until: input.until, token });
    appendActivity(store, { at: input.now, kind: 'work.claimed', actor: input.owner, payload: { workId: input.id, token } });
    return getWork(store, input.id)!;
  });
}

export function releaseWork(
  store: StateStore,
  input: { readonly id: string; readonly owner: string; readonly token: string; readonly at: string },
): WorkItem {
  return store.transaction(() => {
    const current = getWork(store, input.id);
    if (!current) throw new Error(`no work ${input.id}`);
    if (current.claimOwner !== input.owner || current.claimToken !== input.token) {
      throw new Error(`work ${input.id} is not held under that token`);
    }
    store.db
      .prepare(
        `UPDATE work_items SET status = 'open', claim_owner = NULL, claim_token = NULL, claim_until = NULL,
            revision = revision + 1, updated_at = ?
          WHERE id = ?`,
      )
      .run(input.at, input.id);
    recordEvent(store, input.id, input.at, 'released', input.owner, current.revision + 1, {});
    return getWork(store, input.id)!;
  });
}

export function completeWork(
  store: StateStore,
  input: { readonly id: string; readonly owner: string; readonly token?: string; readonly at: string; readonly reason?: string; readonly expectedRevision?: number },
): WorkItem {
  return setTerminal(store, { ...input, status: 'completed' });
}

export function cancelWork(
  store: StateStore,
  input: { readonly id: string; readonly actor: string; readonly at: string; readonly reason: string; readonly expectedRevision?: number },
): WorkItem {
  return setTerminal(store, { id: input.id, owner: input.actor, at: input.at, reason: input.reason, expectedRevision: input.expectedRevision, status: 'cancelled' });
}

export function reopenWork(
  store: StateStore,
  input: { readonly id: string; readonly actor: string; readonly at: string; readonly reason: string; readonly expectedRevision?: number },
): WorkItem {
  requireNonEmpty(input.reason, 'work.reopen.reason');
  return store.transaction(() => {
    const current = getWork(store, input.id);
    if (!current) throw new Error(`no work ${input.id}`);
    if (input.expectedRevision !== undefined && current.revision !== input.expectedRevision) {
      throw new Error(`work ${input.id} is at revision ${String(current.revision)}; expected ${String(input.expectedRevision)}`);
    }
    if (current.status !== 'completed' && current.status !== 'cancelled' && current.status !== 'historical') {
      throw new Error(`work ${input.id} is ${current.status}; only completed, cancelled, or historical work reopens`);
    }
    store.db
      .prepare(
        `UPDATE work_items SET status = 'open', completed_at = NULL, reason = ?, claim_owner = NULL, claim_token = NULL, claim_until = NULL,
            revision = revision + 1, updated_at = ? WHERE id = ?`,
      )
      .run(input.reason, input.at, input.id);
    recordEvent(store, input.id, input.at, 'reopened', input.actor, current.revision + 1, { reason: input.reason, from: current.status });
    return getWork(store, input.id)!;
  });
}

export function supersedeWork(
  store: StateStore,
  input: { readonly id: string; readonly successorId: string; readonly actor: string; readonly at: string; readonly reason: string },
): WorkItem {
  return store.transaction(() => {
    const current = getWork(store, input.id);
    const successor = getWork(store, input.successorId);
    if (!current) throw new Error(`no work ${input.id}`);
    if (!successor) throw new Error(`no work ${input.successorId}`);
    store.db
      .prepare(
        `UPDATE work_items SET status = 'superseded', superseded_by = ?, reason = ?, revision = revision + 1, updated_at = ? WHERE id = ?`,
      )
      .run(input.successorId, input.reason, input.at, input.id);
    recordEvent(store, input.id, input.at, 'superseded', input.actor, current.revision + 1, { successorId: input.successorId, reason: input.reason });
    return getWork(store, input.id)!;
  });
}

function setTerminal(
  store: StateStore,
  input: {
    readonly id: string;
    readonly owner: string;
    readonly token?: string;
    readonly at: string;
    readonly reason?: string;
    readonly expectedRevision?: number;
    readonly status: 'completed' | 'cancelled';
  },
): WorkItem {
  requireInstant(input.at, 'work.at');
  return store.transaction(() => {
    const current = getWork(store, input.id);
    if (!current) throw new Error(`no work ${input.id}`);
    if (input.expectedRevision !== undefined && current.revision !== input.expectedRevision) {
      throw new Error(`work ${input.id} is at revision ${String(current.revision)}; expected ${String(input.expectedRevision)}`);
    }
    if (TERMINAL.includes(current.status)) throw new Error(`work ${input.id} is already ${current.status}`);
    if (input.token && (current.claimOwner !== input.owner || current.claimToken !== input.token)) {
      throw new Error(`work ${input.id} is not held under that token`);
    }
    store.db
      .prepare(
        `UPDATE work_items SET status = ?, completed_at = ?, reason = ?, claim_owner = NULL, claim_token = NULL, claim_until = NULL,
            revision = revision + 1, updated_at = ? WHERE id = ?`,
      )
      .run(input.status, input.at, input.reason ?? null, input.at, input.id);
    recordEvent(store, input.id, input.at, input.status, input.owner, current.revision + 1, { reason: input.reason ?? null });
    appendActivity(store, { at: input.at, kind: `work.${input.status}`, actor: input.owner, payload: { workId: input.id } });
    return getWork(store, input.id)!;
  });
}

export function associateRun(
  store: StateStore,
  input: { readonly workId: string; readonly runId: string; readonly role: 'implements' | 'verifies' | 'reviews'; readonly at: string },
): void {
  if (!getWork(store, input.workId)) throw new Error(`no work ${input.workId}`);
  store.db
    .prepare(`INSERT OR IGNORE INTO work_runs (work_id, run_id, role, created_at) VALUES (?, ?, ?, ?)`)
    .run(input.workId, input.runId, input.role, input.at);
}

export interface WorkExport {
  readonly format: 'construct-work-export';
  readonly formatVersion: 1;
  readonly exportedAt: string;
  readonly projectId: string | null;
  readonly work: readonly unknown[];
  readonly dependencies: readonly unknown[];
  readonly events: readonly unknown[];
  readonly legacyIds: readonly unknown[];
}

export function exportWork(store: StateStore, at: string, projectId: string | null): WorkExport {
  return {
    format: 'construct-work-export',
    formatVersion: 1,
    exportedAt: at,
    projectId,
    work: store.db.prepare('SELECT * FROM work_items ORDER BY created_at, id').all(),
    dependencies: store.db.prepare('SELECT * FROM work_dependencies ORDER BY created_at, id').all(),
    events: store.db.prepare('SELECT work_id, at, kind, actor, expected_revision, payload_json FROM work_events ORDER BY id').all(),
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
export function restoreWork(store: StateStore, dump: WorkExport, at: string): RestoreReport {
  if (dump.format !== 'construct-work-export' || dump.formatVersion !== 1) {
    throw new Error('this is not a construct-work-export v1 snapshot');
  }
  const conflicts: string[] = [];
  let imported = 0;
  let skipped = 0;
  return store.transaction(() => {
    for (const raw of dump.work) {
      const row = raw as Row;
      const existing = getWork(store, row.id);
      if (existing) {
        skipped += 1;
        if (existing.revision !== row.revision) conflicts.push(`${row.id}: live revision ${String(existing.revision)} vs snapshot ${String(row.revision)}`);
        continue;
      }
      store.db
        .prepare(
          `INSERT INTO work_items
             (id, kind, title, description, status, scope_json, premises_json, acceptance_json, risk_json,
              entity_id, parent_id, superseded_by, revision, created_at, updated_at, completed_at, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
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
          row.parent_id,
          row.superseded_by,
          row.revision,
          row.created_at,
          at,
          row.completed_at,
          row.reason,
        );
      imported += 1;
    }
    for (const raw of dump.dependencies) {
      const d = raw as { id: string; from_id: string; to_id: string; kind: WorkDepKind; created_at: string };
      store.db.prepare(`INSERT OR IGNORE INTO work_dependencies (id, from_id, to_id, kind, created_at) VALUES (?, ?, ?, ?, ?)`).run(d.id, d.from_id, d.to_id, d.kind, d.created_at);
    }
    for (const raw of dump.legacyIds) {
      const l = raw as { legacy_id: string; work_id: string; source: string; created_at: string };
      store.db.prepare(`INSERT OR IGNORE INTO work_legacy_ids (legacy_id, work_id, source, created_at) VALUES (?, ?, ?, ?)`).run(l.legacy_id, l.work_id, l.source, l.created_at);
    }
    return { imported, skipped, conflicts };
  });
}
