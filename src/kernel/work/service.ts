/**
 * kernel/work/service.ts — the native bounded work ledger.
 *
 * Work items, blocking and informational dependencies, atomic claims with
 * fencing tokens, and versioned export/restore live here. Workflow runs stay
 * in kernel/state/runs.ts; a work item may have many runs without duplicating
 * its business meaning. Readiness is computed from admission, blocking
 * dependencies, live claims, and premises a source refresh marked stale —
 * not from a status string alone. Parents, reasons, and admission live in
 * structure.ts.
 */

import { getRun } from '../state/runs.ts';
import { runExecutionProblems } from '../workflow/verification.ts';
import type { RefResolver } from '../project/evidence.ts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { normalizePacket, offeredTo, parseHandoff, type Handoff } from './handoff.ts';
import {
  MAIN_LANE,
  findOverlaps,
  leasesFor,
  releasePaths,
  reservePaths,
  transferPaths,
  type CrossLanePolicy,
  type LeaseMode,
  type Overlap,
  type PathLease,
} from './leases.ts';
import type { StateStore } from '../state/open.ts';
import { appendActivity } from '../state/activity.ts';
import { canonicalInstant, parseJson, requireInstant, requireNonEmpty, requireOneOf, toJson } from '../state/rows.ts';
import { addEntity, getEntity, listRelations, validateRelationEndpoints, type Entity, type Relation } from '../state/graph.ts';

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

/**
 * The work event a delegated attempt records on its child item. Those children
 * are attempt records, not deliverables: they end with their parent.
 */
export const DELEGATION_ATTEMPT_EVENT = 'delegation.state.v1';

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
  /** Never carried on a read: only the claim that minted it returns it (see ClaimedWork). */
  readonly claimToken: string | null;
  readonly claimUntil: string | null;
  /** The Construct session holding the claim, and the agent inside it, when known. */
  readonly claimSession: string | null;
  readonly claimAgent: string | null;
  /** The worktree the holder works in, when not the main checkout. */
  readonly claimLane: string | null;
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
  readonly claim_session: string | null;
  readonly claim_agent: string | null;
  readonly claim_lane: string | null;
  readonly handoff_json: string | null;
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
    claimToken: null,
    claimUntil: row.claim_until,
    claimSession: row.claim_session,
    claimAgent: row.claim_agent,
    claimLane: row.claim_lane,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    reason: row.reason,
  };
}

export function recordEvent(
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
  const map = store.db.prepare('SELECT work_id FROM work_legacy_ids WHERE legacy_id = ?').get(legacyId) as { work_id: string } | undefined;
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

/** Items whose parent is `id`, oldest first. */
export function childrenOf(store: StateStore, id: string): WorkItem[] {
  const rows = store.db.prepare('SELECT * FROM work_items WHERE parent_id = ? ORDER BY created_at, id').all(id) as unknown as Row[];
  return rows.map(toWork);
}

/** A work item's acceptance criteria, as the list of statements a finished item meets. */
export function acceptanceOf(work: WorkItem): readonly string[] {
  return Array.isArray(work.acceptance) ? work.acceptance.filter((c): c is string => typeof c === 'string' && c.trim() !== '') : [];
}

export interface WorkQuery {
  readonly status?: WorkStatus;
  readonly kind?: WorkKind;
  readonly query?: string;
  /** Only the direct children of this work item. */
  readonly parentId?: string;
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
        WHERE (? IS NULL OR status = ?) AND (? IS NULL OR kind = ?) AND (? IS NULL OR parent_id = ?)
        ORDER BY updated_at DESC, id`,
    )
    .all(
      filter.status ?? null,
      filter.status ?? null,
      filter.kind ?? null,
      filter.kind ?? null,
      filter.parentId ?? null,
      filter.parentId ?? null,
    ) as unknown as Row[];
  const matched = q ? rows.filter((r) => `${r.id} ${r.title} ${r.description}`.toLowerCase().includes(q)) : rows;
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

export interface WorkDep {
  readonly id: string;
  readonly fromId: string;
  readonly toId: string;
  readonly kind: WorkDepKind;
}

export function listWorkDependencies(store: StateStore, workId?: string): WorkDep[] {
  const rows = (
    workId
      ? store.db.prepare('SELECT * FROM work_dependencies WHERE from_id = ? OR to_id = ?').all(workId, workId)
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
    const next = store.db.prepare(`SELECT to_id FROM work_dependencies WHERE from_id = ? AND kind = 'blocks'`).all(id) as Array<{
      to_id: string;
    }>;
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
  if (isStale(work.premises)) blockers.push('premises changed; requalify before dispatch');
  else if (work.status === 'blocked') blockers.push('blocked');
  return { ready: blockers.length === 0, blockers };
}

function isStale(premises: unknown): boolean {
  return premises !== null && typeof premises === 'object' && (premises as { stale?: unknown }).stale === true;
}

function staleMark(premises: unknown): { stale: true; staleSource: unknown; staleAt: unknown } {
  const p = premises as { staleSource?: unknown; staleAt?: unknown };
  return { stale: true, staleSource: p.staleSource ?? null, staleAt: p.staleAt ?? null };
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

/** The reservation a managed run holds for its requested artifact. It is the run's to settle, never a host's to claim. */
export function isRunDelivery(work: Pick<WorkItem, 'scope'>): boolean {
  return (work.scope as { kind?: unknown } | null)?.kind === 'managed_delivery';
}

/**
 * A run that failed or was cancelled can never deliver its artifact, so its
 * delivery reservation is cancelled with it, whoever holds the reservation:
 * the run's end is the authority, not a session's token.
 */
export function endRunDelivery(
  store: StateStore,
  input: { readonly runId: string; readonly state: 'failed' | 'cancelled'; readonly at: string },
): void {
  const row = rowOf(store, `work-${input.runId}-delivery`);
  if (!row) return;
  const work = toWork(row);
  if (TERMINAL.includes(work.status) || !isRunDelivery(work) || (work.scope as { runId?: unknown }).runId !== input.runId) return;
  const live = liveClaim(row, input.at);
  setTerminal(store, {
    id: work.id,
    owner: live ? row.claim_owner! : 'kernel',
    token: live ? row.claim_token! : undefined,
    at: input.at,
    reason: `its run ${input.runId} was ${input.state}, so it can never deliver`,
    status: 'cancelled',
  });
}

export function listReady(store: StateStore, at: string, limit = 50): WorkItem[] {
  const rows = store.db
    .prepare(
      `SELECT * FROM work_items
        WHERE status NOT IN ('completed', 'cancelled', 'superseded', 'historical', 'proposed', 'in_progress')
          AND (status <> 'claimed' OR claim_until IS NULL OR claim_until <= ?)
        ORDER BY updated_at DESC, id`,
    )
    .all(at) as unknown as Row[];
  const out: WorkItem[] = [];
  for (const row of rows) {
    const w = toWork(row);
    if (w.claimOwner && w.claimUntil && w.claimUntil > at) continue;
    if (isRunDelivery(w)) continue;
    if (readinessOf(store, w, at).ready) out.push(w);
    if (out.length >= limit) break;
  }
  return out;
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

/** A work item as its claimer sees it: the only place the claim token appears. */
export type ClaimedWork = WorkItem & {
  readonly claimToken: string;
  /** The paths this claim reserved, when it named any. */
  readonly leases?: readonly PathLease[];
  /** Overlaps with reservations in other worktrees, accepted as merge risks. */
  readonly mergeRisks?: readonly Overlap[];
  /**
   * After a takeover or an accepted handoff: reservations that were released
   * rather than moved, because another claim holds those paths in the new
   * holder's checkout.
   */
  readonly dropped?: readonly Overlap[];
};

/** What a claim reserves: repository paths, how exclusively, and in which checkout. */
export interface Reservation {
  readonly paths?: readonly string[];
  readonly mode?: LeaseMode;
  readonly branch?: string | null;
  readonly crossLane?: CrossLanePolicy;
}

/** The checkout a claimant works in, as reservations compare it: its worktree, or the main checkout. */
function laneKey(lane: string | undefined): string {
  return lane ?? MAIN_LANE;
}

/** Who is claiming: the owner string of record, and the session, agent, and lane behind it. */
export interface Claimant {
  readonly owner: string;
  readonly session?: string;
  readonly agent?: string;
  readonly lane?: string;
}

/** How long a holder may go without any Construct call before its claim can be taken over. */
export const CLAIM_QUIET_CAP_MS = 2 * 60 * 60_000;

function liveClaim(row: Row, now: string): boolean {
  return row.status === 'claimed' && row.claim_owner !== null && row.claim_until !== null && row.claim_until > now;
}

function isDelegationAttempt(store: StateStore, id: string): boolean {
  return (
    store.db.prepare('SELECT 1 FROM work_events WHERE work_id = ? AND kind = ? LIMIT 1').get(id, DELEGATION_ATTEMPT_EVENT) !== undefined
  );
}

function rowOf(store: StateStore, id: string): Row | null {
  return (store.db.prepare('SELECT * FROM work_items WHERE id = ?').get(id) as Row | undefined) ?? null;
}

function withToken(item: WorkItem, token: string): ClaimedWork {
  return { ...item, claimToken: token };
}

function setClaim(store: StateStore, id: string, who: Claimant, token: string, until: string, now: string): void {
  store.db
    .prepare(
      `UPDATE work_items SET status = 'claimed', claim_owner = ?, claim_token = ?, claim_until = ?,
          claim_session = ?, claim_agent = ?, claim_lane = ?, claim_touched_at = ?,
          revision = revision + 1, updated_at = ?
        WHERE id = ?`,
    )
    .run(who.owner, token, until, who.session ?? null, who.agent ?? null, who.lane ?? null, now, now, id);
}

/** Every acquisition uses the same time and readiness contract. */
function claimBounds<T extends { readonly owner: string; readonly now: string; readonly until: string }>(input: T): T {
  requireNonEmpty(input.owner, 'claim.owner');
  const now = canonicalInstant(input.now, 'claim.now');
  const until = canonicalInstant(input.until, 'claim.until');
  if (until <= now) throw new Error('claim.until must be after now');
  return { ...input, now, until };
}

function requireReadyForClaim(store: StateStore, current: WorkItem, now: string): void {
  const ready = readinessOf(store, { ...current, claimOwner: null, claimUntil: null }, now);
  if (!ready.ready) throw new Error(`work ${current.id} is not ready: ${ready.blockers.join('; ')}`);
}

/**
 * Claim a work item. The claim is exclusive until it expires: another owner is
 * refused, and so is the same owner without the token its first claim
 * returned (with the token, the claim is renewed). The token is a random
 * nonce returned only here; events, activity, and reads never carry it.
 */
export function claimWork(
  store: StateStore,
  input: Claimant &
    Reservation & {
      readonly id: string;
      readonly until: string;
      readonly now: string;
      readonly token?: string;
      readonly expectedRevision?: number;
    },
): ClaimedWork {
  input = claimBounds(input);
  return store.transaction(() => {
    const row = rowOf(store, input.id);
    if (!row) throw new Error(`no work ${input.id}`);
    const current = toWork(row);
    if (input.expectedRevision !== undefined && current.revision !== input.expectedRevision) {
      throw new Error(`work ${input.id} is at revision ${String(current.revision)}; expected ${String(input.expectedRevision)}`);
    }
    if (TERMINAL.includes(current.status)) throw new Error(`work ${input.id} is ${current.status}`);
    if (liveClaim(row, input.now)) {
      if (row.claim_owner !== input.owner) {
        throw new Error(`work ${input.id} is claimed by ${row.claim_owner} until ${row.claim_until}`);
      }
      if (input.token !== row.claim_token) {
        throw new Error(`you already hold ${input.id} until ${row.claim_until}; pass the token your claim returned to renew it`);
      }
      // Renewals never shorten either an ordinary claim or a handoff hold.
      const until = row.claim_until! > input.until ? row.claim_until! : input.until;
      const held = leasesFor(store, input.id);
      const moving = laneKey(input.lane) !== laneKey(row.claim_lane ?? undefined);
      // Preserve inherited paths on an explicit worktree move. reserveFor uses
      // the existing collision engine inside this transaction; refusal rolls
      // back the owner metadata, term and reservations together.
      const reservation =
        moving && !input.paths?.length && held.length
          ? { ...input, until, paths: held.map((l) => l.path), mode: input.mode ?? held[0]!.mode }
          : { ...input, until };
      setClaim(store, input.id, input, row.claim_token!, until, input.now);
      extendPaths(store, input.id, until);
      recordEvent(store, input.id, input.now, 'renewed', input.owner, current.revision + 1, { until });
      return { ...withToken(getWork(store, input.id)!, row.claim_token!), ...reserveFor(store, reservation) };
    }
    requireReadyForClaim(store, current, input.now);
    const token = randomUUID();
    setClaim(store, input.id, input, token, input.until, input.now);
    // A new claim starts with no reservations: an expired holder's go with its claim.
    releasePaths(store, { workId: input.id, now: input.now, reason: 'claimed again' });
    takeHandoff(store, row, input.owner, input.now, 'claim');
    recordEvent(store, input.id, input.now, 'claimed', input.owner, current.revision + 1, {
      until: input.until,
      session: input.session ?? null,
      agent: input.agent ?? null,
      lane: input.lane ?? null,
    });
    const reserved = reserveFor(store, input);
    appendActivity(store, {
      at: input.now,
      kind: 'work.claimed',
      actor: input.owner,
      payload: { workId: input.id, until: input.until, paths: reserved.leases?.map((l) => l.path) ?? [] },
    });
    return { ...withToken(getWork(store, input.id)!, token), ...reserved };
  });
}

/** Keep a work item's reservations' recorded term in step with its claim. */
function extendPaths(store: StateStore, workId: string, until: string): void {
  store.db.prepare('UPDATE path_leases SET until = ? WHERE work_id = ? AND released_at IS NULL').run(until, workId);
}

/** Reserve the paths a claim names, if any; a collision throws and rolls the claim back. */
function reserveFor(
  store: StateStore,
  input: Claimant & Reservation & { readonly id: string; readonly until: string; readonly now: string },
): { leases?: readonly PathLease[]; mergeRisks?: readonly Overlap[] } {
  if (!input.paths || input.paths.length === 0) return {};
  const r = reservePaths(store, {
    workId: input.id,
    sessionId: input.session ?? input.owner,
    agent: input.agent ?? null,
    laneRoot: laneKey(input.lane),
    branch: input.branch ?? null,
    paths: input.paths,
    mode: input.mode ?? 'exclusive',
    until: input.until,
    now: input.now,
    crossLane: input.crossLane,
  });
  return { leases: r.leases, mergeRisks: r.mergeRisks };
}

/**
 * Take over a claim another holder no longer works: it expired, its session
 * ended, or its session has made no Construct call within the quiet cap. A
 * live, active holder's claim is never taken. The reason is recorded.
 */
export function takeoverWork(
  store: StateStore,
  input: Claimant & {
    readonly id: string;
    readonly until: string;
    readonly now: string;
    readonly reason: string;
    readonly branch?: string | null;
    readonly quietCapMs?: number;
    /**
     * Whether the holder's process still runs, when the caller can tell (same
     * machine); null when it cannot. A holder whose process is gone is gone.
     */
    readonly processAlive?: (pid: number, machine: string) => boolean | null;
  },
): ClaimedWork {
  requireNonEmpty(input.reason, 'work.takeover.reason');
  input = claimBounds(input);
  return store.transaction(() => {
    const row = rowOf(store, input.id);
    if (!row) throw new Error(`no work ${input.id}`);
    const current = toWork(row);
    if (TERMINAL.includes(current.status)) throw new Error(`work ${input.id} is ${current.status}`);
    const live = liveClaim(row, input.now);
    const offer = openOffer(store, row, input.now);
    if (offer && row.claim_owner !== input.owner) {
      // An offered handoff is taken by accepting it, and only by whom it names, until its hold ends.
      throw new Error(
        offeredTo(offer, input.owner, input.session)
          ? `work ${input.id} is offered to you as a handoff; accept it instead`
          : `work ${input.id} is offered as a handoff to ${offer.to!} until ${row.claim_until}; only they may take it until then`,
      );
    }
    if (live) {
      if (row.claim_owner === input.owner) {
        throw new Error(`you already hold ${input.id}; renew it with the token your claim returned rather than taking it over`);
      }
      // A session's own main agent may take work back from one of its agents.
      const parentReclaim =
        input.session !== undefined && row.claim_session === input.session && input.agent === 'main' && row.claim_agent !== 'main';
      if (!parentReclaim) {
        if (!row.claim_session) {
          throw new Error(
            `work ${input.id} is held by ${row.claim_owner} until ${row.claim_until} with no session to check; it frees itself then`,
          );
        }
        const holder = store.db.prepare('SELECT last_seen_at, ended_at, pid, machine FROM sessions WHERE id = ?').get(row.claim_session) as
          | { last_seen_at: string; ended_at: string | null; pid: number | null; machine: string }
          | undefined;
        const quietSince = holder ? Date.parse(input.now) - Date.parse(holder.last_seen_at) : 0;
        const processGone = holder !== undefined && holder.pid !== null && input.processAlive?.(holder.pid, holder.machine) === false;
        const gone =
          holder !== undefined && (holder.ended_at !== null || processGone || quietSince > (input.quietCapMs ?? CLAIM_QUIET_CAP_MS));
        if (!gone) {
          throw new Error(
            `work ${input.id} is held by ${row.claim_owner} until ${row.claim_until}, and that session is still active; it cannot be taken over yet`,
          );
        }
      }
    }
    requireReadyForClaim(store, current, input.now);
    const token = randomUUID();
    setClaim(store, input.id, input, token, input.until, input.now);
    takeHandoff(store, row, input.owner, input.now, 'takeover');
    // A live holder's reservations move to the taker; an expired claim's ended with it.
    const moved = live
      ? transferPaths(store, {
          workId: input.id,
          sessionId: input.session ?? input.owner,
          agent: input.agent ?? null,
          laneRoot: laneKey(input.lane),
          branch: input.branch,
          until: input.until,
          now: input.now,
        })
      : { leases: [], dropped: [] };
    if (!live) releasePaths(store, { workId: input.id, now: input.now, reason: 'claim expired before the takeover' });
    recordEvent(store, input.id, input.now, 'taken_over', input.owner, current.revision + 1, {
      from: row.claim_owner,
      reason: input.reason,
    });
    appendActivity(store, {
      at: input.now,
      kind: 'work.taken_over',
      actor: input.owner,
      payload: { workId: input.id, from: row.claim_owner, reason: input.reason },
    });
    return withMoved(store, withToken(getWork(store, input.id)!, token), moved, laneKey(input.lane), input.now);
  });
}

/**
 * A claim that inherited reservations, with what it now holds, what was
 * released because another claim holds it in this checkout, and what overlaps
 * reservations in other worktrees.
 */
function withMoved(
  store: StateStore,
  claimed: ClaimedWork,
  moved: { readonly leases: readonly PathLease[]; readonly dropped: readonly Overlap[] },
  lane: string,
  now: string,
): ClaimedWork {
  if (moved.leases.length === 0 && moved.dropped.length === 0) return claimed;
  const mergeRisks =
    moved.leases.length === 0
      ? []
      : findOverlaps(store, {
          paths: moved.leases.map((l) => l.path),
          laneRoot: lane,
          now,
          mode: moved.leases[0]!.mode,
          excludeWorkId: claimed.id,
        }).filter((o) => o.kind === 'merge_risk');
  return { ...claimed, leases: moved.leases, dropped: moved.dropped, mergeRisks };
}

/**
 * How long an offered handoff holds the work and its reservations for the next
 * holder. The offering session's own calls keep renewing it as usual.
 */
export const HANDOFF_HOLD_MS = 2 * 60 * 60_000;

/** An offer still waiting: the claim is live, still the offerer's, and nobody has taken it. */
function identifiedHandoff(store: StateStore, id: string, h: Handoff): Handoff {
  if (h.offerId) return h;
  const event = store.db
    .prepare("SELECT id FROM work_events WHERE work_id = ? AND kind = 'handoff_offered' ORDER BY id DESC LIMIT 1")
    .get(id) as { id: number } | undefined;
  return {
    ...h,
    offerId: createHash('sha256')
      .update(JSON.stringify([id, event?.id ?? null, h.from, h.offeredAt, h.packet]))
      .digest('hex'),
  };
}

function openOffer(store: StateStore, row: Row, now: string): Handoff | null {
  const h = parseHandoff(row.handoff_json);
  if (!h || h.takenBy !== null || !liveClaim(row, now) || row.claim_owner !== h.from) return null;
  return identifiedHandoff(store, row.id, h);
}

/** Record who took on handed-off work when it was claimed or taken over rather than accepted. */
function takeHandoff(store: StateStore, row: Row, owner: string, now: string, via: 'claim' | 'takeover'): void {
  const h = parseHandoff(row.handoff_json);
  if (!h || h.takenBy !== null) return;
  store.db
    .prepare('UPDATE work_items SET handoff_json = ? WHERE id = ?')
    .run(JSON.stringify({ ...h, takenBy: owner, takenAt: now, takenVia: via }), row.id);
}

/** The latest handoff recorded on a work item: offered, taken, or lapsed. */
export function handoffOf(store: StateStore, id: string): Handoff | null {
  const row = rowOf(store, id);
  const h = row ? parseHandoff(row.handoff_json) : null;
  return h ? identifiedHandoff(store, id, h) : null;
}

/**
 * Offer claimed work to the next holder with a packet saying where it stands.
 * Only the holder, with its token, offers. The claim stays the holder's until
 * someone accepts, and is held at least long enough for that; the holder can
 * still settle it with its token. `to` names a claimant or a session; without
 * it anyone in the project may accept.
 */
export function handoffWork(
  store: StateStore,
  input: {
    readonly id: string;
    readonly owner: string;
    readonly token: string;
    readonly packet: Record<string, unknown>;
    readonly to?: string | null;
    readonly now: string;
  },
): WorkItem & { readonly handoff: Handoff } {
  input = { ...input, now: canonicalInstant(input.now, 'work.handoff.now') };
  const packet = normalizePacket(input.packet);
  const to = input.to?.trim() ? input.to.trim() : null;
  if (to === input.owner) throw new Error('a handoff goes to someone else; you already hold this work');
  return store.transaction(() => {
    const row = rowOf(store, input.id);
    if (!row) throw new Error(`no work ${input.id}`);
    const current = toWork(row);
    if (!liveClaim(row, input.now) || row.claim_owner !== input.owner || row.claim_token !== input.token) {
      throw new Error(`work ${input.id} is not held by you under that token; only its holder hands it off`);
    }
    const hold = new Date(Date.parse(input.now) + HANDOFF_HOLD_MS).toISOString();
    const until = row.claim_until! > hold ? row.claim_until! : hold;
    const handoff: Handoff = {
      offerId: randomUUID(),
      from: input.owner,
      to,
      offeredAt: input.now,
      packet,
      takenBy: null,
      takenAt: null,
      takenVia: null,
    };
    store.db
      .prepare('UPDATE work_items SET handoff_json = ?, claim_until = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(handoff), until, input.now, input.id);
    extendPaths(store, input.id, until);
    recordEvent(store, input.id, input.now, 'handoff_offered', input.owner, current.revision + 1, { to });
    appendActivity(store, { at: input.now, kind: 'work.handoff_offered', actor: input.owner, payload: { workId: input.id, to } });
    return { ...getWork(store, input.id)!, handoff };
  });
}

/**
 * Accept an offered handoff: the claim, a new token, and the reservations move
 * to the acceptor in one transaction, and the offerer's token stops working.
 * Approvals and step leases never move with it; whatever the work needs next
 * is asked for again by whoever holds it.
 */
export function prepareAcceptance(
  store: StateStore,
  input: { readonly id: string; readonly owner: string; readonly session?: string; readonly now: string },
): { offerId: string; acceptanceKey: string } {
  const now = canonicalInstant(input.now, 'work.accept.now');
  return store.transaction(() => {
    const row = rowOf(store, input.id);
    const offer = row ? openOffer(store, row, now) : null;
    if (!row || !offer || offer.from === input.owner || !offeredTo(offer, input.owner, input.session))
      throw new Error('work has no open handoff offered to this claimant');
    requireReadyForClaim(store, toWork(row), now);
    // No authority changes, and no capability is stored or logged here. If
    // this response is lost, preparing again has no acceptance side effects.
    return { offerId: offer.offerId!, acceptanceKey: randomBytes(32).toString('hex') };
  });
}

export function acceptWork(
  store: StateStore,
  input: Claimant & {
    readonly id: string;
    readonly until: string;
    readonly now: string;
    readonly branch?: string | null;
    readonly acceptanceKey?: string;
    readonly offerId?: string;
  },
  beforeAcquire?: () => void,
): ClaimedWork & { readonly handoff: Handoff } {
  input = claimBounds(input);
  if (input.acceptanceKey !== undefined && !/^[a-f0-9]{64}$/i.test(input.acceptanceKey))
    throw new Error(
      'acceptanceKey must be 32 cryptographically random bytes encoded as 64 hex characters, retained privately before accepting',
    );
  if (input.acceptanceKey !== undefined && (typeof input.offerId !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/.test(input.offerId)))
    throw new Error('acceptance recovery needs offerId from the observed handoff before dispatch');
  const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
  const keyDigest = input.acceptanceKey === undefined ? null : digest(input.acceptanceKey.toLowerCase());
  return store.transaction(() => {
    const row = rowOf(store, input.id);
    if (!row) throw new Error(`no work ${input.id}`);
    const current = toWork(row);
    // Check prior use before considering a newer offer. A delayed request must
    // never consume a later handoff under an old capability.
    if (keyDigest) {
      const receipt = store.db
        .prepare(
          "SELECT work_id, actor, payload_json FROM work_events WHERE kind = 'handoff_acceptance_receipt' AND json_extract(payload_json, '$.keyDigest') = ? LIMIT 1",
        )
        .get(keyDigest) as { work_id: string; actor: string; payload_json: string } | undefined;
      if (receipt) {
        const saved = JSON.parse(receipt.payload_json) as {
          offerId: string;
          session: string | null;
          lane: string;
          tokenDigest: string;
          offerDigest: string;
          dropped: Overlap[];
        };
        const handoff = parseHandoff(row.handoff_json);
        const original = handoff ? { ...handoff, takenBy: null, takenAt: null, takenVia: null } : null;
        if (
          saved.offerId !== input.offerId ||
          receipt.work_id !== input.id ||
          receipt.actor !== input.owner ||
          saved.session !== (input.session ?? null) ||
          row.claim_session !== saved.session ||
          saved.lane !== laneKey(input.lane) ||
          laneKey(row.claim_lane ?? undefined) !== saved.lane ||
          !liveClaim(row, input.now) ||
          row.claim_owner !== input.owner ||
          !row.claim_token ||
          digest(row.claim_token) !== saved.tokenDigest ||
          !handoff ||
          handoff.takenBy !== input.owner ||
          handoff.takenVia !== 'accept' ||
          digest(JSON.stringify(original)) !== saved.offerDigest
        ) {
          throw new Error(
            'acceptance recovery is unavailable for this claimant or generation; inspect the current handoff and use a fresh capability for a new acceptance',
          );
        }
        return {
          ...withMoved(
            store,
            withToken(current, row.claim_token),
            { leases: leasesFor(store, input.id), dropped: saved.dropped },
            laneKey(input.lane),
            input.now,
          ),
          handoff,
        };
      }
    }
    const h = openOffer(store, row, input.now);
    if (!h) {
      const left = parseHandoff(row.handoff_json);
      if (left && left.takenBy === null && !liveClaim(row, input.now) && !TERMINAL.includes(current.status)) {
        const how = row.status === 'claimed' ? 'lapsed with its claim' : 'was withdrawn when its holder released it';
        throw new Error(`the handoff of ${input.id} ${how}; claim the work instead, and its packet comes with it`);
      }
      throw new Error(`work ${input.id} has no open handoff`);
    }
    if (input.offerId !== undefined && input.offerId !== h.offerId)
      throw new Error('handoff offer generation changed before acceptance; inspect the current handoff before accepting it');
    if (h.from === input.owner) throw new Error(`you offered ${input.id}; release or settle it with your token instead`);
    if (!offeredTo(h, input.owner, input.session)) throw new Error(`the handoff of ${input.id} is offered to ${h.to}`);
    requireReadyForClaim(store, current, input.now);
    // Host filesystem checks fence new acquisition, not recovery of an already
    // granted live generation. A refusal still rolls back the transaction.
    beforeAcquire?.();
    const token = randomUUID();
    setClaim(store, input.id, input, token, input.until, input.now);
    const taken: Handoff = { ...h, takenBy: input.owner, takenAt: input.now, takenVia: 'accept' };
    store.db.prepare('UPDATE work_items SET handoff_json = ? WHERE id = ?').run(JSON.stringify(taken), input.id);
    const moved = transferPaths(store, {
      workId: input.id,
      sessionId: input.session ?? input.owner,
      agent: input.agent ?? null,
      laneRoot: laneKey(input.lane),
      branch: input.branch,
      until: input.until,
      now: input.now,
    });
    if (keyDigest)
      recordEvent(store, input.id, input.now, 'handoff_acceptance_receipt', input.owner, current.revision + 1, {
        keyDigest,
        offerId: h.offerId,
        session: input.session ?? null,
        lane: laneKey(input.lane),
        tokenDigest: digest(token),
        offerDigest: digest(JSON.stringify(h)),
        dropped: moved.dropped,
      });
    recordEvent(store, input.id, input.now, 'handoff_accepted', input.owner, current.revision + 1, { from: h.from });
    appendActivity(store, {
      at: input.now,
      kind: 'work.handoff_accepted',
      actor: input.owner,
      payload: { workId: input.id, from: h.from },
    });
    return { ...withMoved(store, withToken(getWork(store, input.id)!, token), moved, laneKey(input.lane), input.now), handoff: taken };
  });
}

/**
 * Handoffs waiting to be accepted. With a claimant, only those it may accept:
 * offered to anyone, to it, or to its session, and not its own.
 */
export function listOffers(
  store: StateStore,
  now: string,
  who?: { readonly owner: string; readonly session?: string },
): { readonly work: WorkItem; readonly handoff: Handoff }[] {
  const rows = store.db
    .prepare(`SELECT * FROM work_items WHERE status = 'claimed' AND claim_until > ? AND handoff_json IS NOT NULL ORDER BY updated_at, id`)
    .all(now) as unknown as Row[];
  const out: { work: WorkItem; handoff: Handoff }[] = [];
  for (const row of rows) {
    const h = openOffer(store, row, now);
    if (!h) continue;
    if (who && (h.from === who.owner || !offeredTo(h, who.owner, who.session))) continue;
    out.push({ work: toWork(row), handoff: h });
  }
  return out;
}

/**
 * Extend a session's live claims that are past half their term, so a holder
 * that keeps calling Construct never loses work to expiry. Returns how many
 * were extended.
 */
export function renewSessionClaims(
  store: StateStore,
  input: { readonly session: string; readonly now: string; readonly termMs: number; readonly excludeWorkId?: string },
): number {
  input = { ...input, now: canonicalInstant(input.now, 'claim.now') };
  if (!Number.isFinite(input.termMs) || input.termMs <= 0) throw new Error('claim.termMs must be positive and finite');
  return store.transaction(() => {
    const until = new Date(Date.parse(input.now) + input.termMs).toISOString();
    const halfway = new Date(Date.parse(input.now) + input.termMs / 2).toISOString();
    const changed = Number(
      store.db
        .prepare(
          `UPDATE work_items SET claim_until = ?, claim_touched_at = ?
            WHERE claim_session = ? AND status = 'claimed' AND claim_until > ? AND claim_until < ? AND (? IS NULL OR id <> ?)`,
        )
        .run(until, input.now, input.session, input.now, halfway, input.excludeWorkId ?? null, input.excludeWorkId ?? null).changes,
    );
    if (changed > 0) {
      store.db
        .prepare(
          `UPDATE path_leases SET until = ?
            WHERE released_at IS NULL AND work_id IN (SELECT id FROM work_items WHERE claim_session = ? AND status = 'claimed' AND claim_until = ? AND (? IS NULL OR id <> ?))`,
        )
        .run(until, input.session, until, input.excludeWorkId ?? null, input.excludeWorkId ?? null);
    }
    return changed;
  });
}

export function releaseWork(
  store: StateStore,
  input: { readonly id: string; readonly owner: string; readonly token: string; readonly at: string },
): WorkItem {
  input = { ...input, at: canonicalInstant(input.at, 'work.release.at') };
  return store.transaction(() => {
    const row = rowOf(store, input.id);
    if (!row) throw new Error(`no work ${input.id}`);
    const current = toWork(row);
    // Releasing this exact expired generation is safe cleanup; it cannot
    // settle results or release a successor's different token.
    if (row.claim_owner !== input.owner || row.claim_token !== input.token) {
      throw new Error(`work ${input.id} is not held under that token`);
    }
    store.db
      .prepare(
        `UPDATE work_items SET status = 'open', claim_owner = NULL, claim_token = NULL, claim_until = NULL,
            claim_session = NULL, claim_agent = NULL, claim_lane = NULL, revision = revision + 1, updated_at = ?
          WHERE id = ?`,
      )
      .run(input.at, input.id);
    releasePaths(store, { workId: input.id, now: input.at, reason: 'released' });
    recordEvent(store, input.id, input.at, 'released', input.owner, current.revision + 1, {});
    return getWork(store, input.id)!;
  });
}

export function completeWork(
  store: StateStore,
  input: {
    readonly id: string;
    readonly owner: string;
    readonly token?: string;
    readonly at: string;
    readonly reason?: string;
    readonly expectedRevision?: number;
    readonly resolveEvidence?: RefResolver;
  },
): WorkItem {
  const scope = getWork(store, input.id)?.scope as { kind?: string; runId?: string } | null;
  if (scope?.kind === 'managed_delivery') {
    if (
      !scope.runId ||
      !input.resolveEvidence ||
      getRun(store, scope.runId)?.state !== 'succeeded' ||
      runExecutionProblems(store, scope.runId, input.resolveEvidence).length
    )
      throw new Error('managed delivery completes only with its succeeded run and current artifact review; use submit_work');
  }
  return setTerminal(store, { ...input, status: 'completed' });
}

export function cancelWork(
  store: StateStore,
  input: {
    readonly id: string;
    readonly actor: string;
    readonly at: string;
    readonly reason: string;
    readonly token?: string;
    readonly expectedRevision?: number;
  },
): WorkItem {
  return setTerminal(store, {
    id: input.id,
    owner: input.actor,
    token: input.token,
    at: input.at,
    reason: input.reason,
    expectedRevision: input.expectedRevision,
    status: 'cancelled',
  });
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
    recordEvent(store, input.id, input.at, 'superseded', input.actor, current.revision + 1, {
      successorId: input.successorId,
      reason: input.reason,
    });
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
  input = { ...input, at: canonicalInstant(input.at, 'work.at') };
  return store.transaction(() => {
    const row = rowOf(store, input.id);
    if (!row) throw new Error(`no work ${input.id}`);
    const current = toWork(row);
    if (input.expectedRevision !== undefined && current.revision !== input.expectedRevision) {
      throw new Error(`work ${input.id} is at revision ${String(current.revision)}; expected ${String(input.expectedRevision)}`);
    }
    if (TERMINAL.includes(current.status)) throw new Error(`work ${input.id} is already ${current.status}`);
    const unfinished = childrenOf(store, input.id).filter((c) => !TERMINAL.includes(c.status));
    const attempts = unfinished.filter((c) => isDelegationAttempt(store, c.id));
    const openChildren = unfinished.filter((c) => !attempts.includes(c));
    if (openChildren.length > 0) {
      throw new Error(
        `work ${input.id} still has ${String(openChildren.length)} open child item(s): ${openChildren
          .slice(0, 5)
          .map((c) => c.id)
          .join(', ')}${openChildren.length > 5 ? ', …' : ''}; complete or cancel them first`,
      );
    }
    const running = attempts.filter((c) => liveClaim(rowOf(store, c.id)!, input.at));
    if (running.length > 0) {
      throw new Error(
        `work ${input.id} has a delegated attempt still running (${running.map((c) => c.id).join(', ')}); cancel it or let it finish first`,
      );
    }
    if (input.status === 'completed' && acceptanceOf(current).length > 0 && !input.reason?.trim()) {
      throw new Error(`work ${input.id} has acceptance criteria; say how they were met in the reason`);
    }
    if (input.status === 'completed') {
      // Ownership is checked below; readiness here checks whether the work can
      // truthfully finish, including changes that occurred during a claim.
      const ready = readinessOf(store, { ...current, claimOwner: null, claimUntil: null }, input.at);
      if (!ready.ready) throw new Error(`work ${input.id} cannot complete: ${ready.blockers.join('; ')}`);
    }
    // Expiry frees acquisition, never settlement by a stale generation.
    if (row.status === 'claimed' && !liveClaim(row, input.at) && (input.status === 'completed' || input.token !== undefined)) {
      throw new Error(`work ${input.id} claim expired; claim the work again before settling it`);
    }
    // A live claim is settled only with both its owner and token.
    if (liveClaim(row, input.at) && (input.token !== row.claim_token || input.owner !== row.claim_owner)) {
      throw new Error(
        `work ${input.id} is held by ${row.claim_owner} until ${row.claim_until}; ${input.token ? 'that owner and token do not hold it' : 'settle it with the token its claim returned, or take it over once it is free'}`,
      );
    }
    if (input.token !== undefined && row.status !== 'claimed') {
      throw new Error(`work ${input.id} is not held under that token; claim it before settling it`);
    }
    store.db
      .prepare(
        `UPDATE work_items SET status = ?, completed_at = ?, reason = ?, claim_owner = NULL, claim_token = NULL, claim_until = NULL,
            claim_session = NULL, claim_agent = NULL, claim_lane = NULL, revision = revision + 1, updated_at = ? WHERE id = ?`,
      )
      .run(input.status, input.at, input.reason ?? null, input.at, input.id);
    releasePaths(store, { workId: input.id, now: input.at, reason: input.status });
    recordEvent(store, input.id, input.at, input.status, input.owner, current.revision + 1, { reason: input.reason ?? null });
    for (const attempt of attempts) {
      const ended = `its parent ${input.id} was ${input.status}`;
      store.db
        .prepare(`UPDATE work_items SET status = 'cancelled', completed_at = ?, reason = ?, claim_owner = NULL, claim_token = NULL, claim_until = NULL,
            claim_session = NULL, claim_agent = NULL, claim_lane = NULL, revision = revision + 1, updated_at = ? WHERE id = ?`)
        .run(input.at, ended, input.at, attempt.id);
      releasePaths(store, { workId: attempt.id, now: input.at, reason: 'cancelled' });
      recordEvent(store, attempt.id, input.at, 'cancelled', input.owner, attempt.revision + 1, { reason: ended });
    }
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
