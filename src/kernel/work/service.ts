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

import { randomUUID } from 'node:crypto';
import { normalizePacket, offeredTo, parseHandoff, type Handoff } from './handoff.ts';
import { MAIN_LANE, findOverlaps, releasePaths, reservePaths, transferPaths, type CrossLanePolicy, type LeaseMode, type Overlap, type PathLease } from './leases.ts';
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
    .all(filter.status ?? null, filter.status ?? null, filter.kind ?? null, filter.kind ?? null, filter.parentId ?? null, filter.parentId ?? null) as unknown as Row[];
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

/** Remove one dependency; true when there was one to remove. */
export function removeWorkDependency(store: StateStore, input: { readonly fromId: string; readonly toId: string; readonly kind: WorkDepKind }): boolean {
  requireOneOf(input.kind, WORK_DEP_KINDS, 'work.dep.kind');
  return store.db.prepare('DELETE FROM work_dependencies WHERE from_id = ? AND to_id = ? AND kind = ?').run(input.fromId, input.toId, input.kind).changes > 0;
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
    const { stale: _stale, staleSource, staleAt: _staleAt, ...rest } = current.premises as { stale: boolean; staleSource?: unknown; staleAt?: unknown };
    store.db
      .prepare(`UPDATE work_items SET premises_json = ?, status = CASE WHEN status = 'blocked' THEN 'open' ELSE status END, revision = revision + 1, updated_at = ? WHERE id = ?`)
      .run(toJson(rest), input.at, input.id);
    recordEvent(store, input.id, input.at, 'requalified', input.actor ?? null, current.revision + 1, { reason: input.reason, staleSource: staleSource ?? null });
    return getWork(store, input.id)!;
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
    if (TERMINAL.includes(current.status)) throw new Error(`work ${input.id} is ${current.status}; reopen it before editing`);
    if (current.revision !== input.expectedRevision) {
      throw new Error(`work ${input.id} is at revision ${String(current.revision)}; expected ${String(input.expectedRevision)}`);
    }
    // New premises never clear a stale mark: only requalifying does, with a reason.
    const stale = isStale(current.premises) ? staleMark(current.premises) : null;
    const premises = input.premises === undefined || stale === null || typeof input.premises !== 'object' || input.premises === null
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
    recordEvent(store, input.id, input.at, 'updated', input.actor ?? null, current.revision + 1, { fields: Object.keys(input).filter((k) => k !== 'id' && k !== 'expectedRevision' && k !== 'at' && k !== 'actor') });
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
  return store.db.prepare('SELECT 1 FROM work_events WHERE work_id = ? AND kind = ? LIMIT 1').get(id, DELEGATION_ATTEMPT_EVENT) !== undefined;
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

/**
 * Claim a work item. The claim is exclusive until it expires: another owner is
 * refused, and so is the same owner without the token its first claim
 * returned (with the token, the claim is renewed). The token is a random
 * nonce returned only here; events, activity, and reads never carry it.
 */
export function claimWork(
  store: StateStore,
  input: Claimant & Reservation & { readonly id: string; readonly until: string; readonly now: string; readonly token?: string; readonly expectedRevision?: number },
): ClaimedWork {
  requireNonEmpty(input.owner, 'work.claim.owner');
  requireInstant(input.until, 'work.claim.until');
  requireInstant(input.now, 'work.claim.now');
  if (input.until <= input.now) throw new Error('claim.until must be after now');
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
      // An offered handoff keeps the longer hold it was given.
      const until = openOffer(row, input.now) && row.claim_until! > input.until ? row.claim_until! : input.until;
      setClaim(store, input.id, input, row.claim_token!, until, input.now);
      extendPaths(store, input.id, until);
      recordEvent(store, input.id, input.now, 'renewed', input.owner, current.revision + 1, { until });
      return { ...withToken(getWork(store, input.id)!, row.claim_token!), ...reserveFor(store, input) };
    }
    const ready = readinessOf(store, { ...current, claimOwner: null, claimUntil: null }, input.now);
    if (!ready.ready) throw new Error(`work ${input.id} is not ready: ${ready.blockers.join('; ')}`);
    const token = randomUUID();
    setClaim(store, input.id, input, token, input.until, input.now);
    // A new claim starts with no reservations: an expired holder's go with its claim.
    releasePaths(store, { workId: input.id, now: input.now, reason: 'claimed again' });
    takeHandoff(store, row, input.owner, input.now, 'claim');
    recordEvent(store, input.id, input.now, 'claimed', input.owner, current.revision + 1, { until: input.until, session: input.session ?? null, agent: input.agent ?? null, lane: input.lane ?? null });
    const reserved = reserveFor(store, input);
    appendActivity(store, { at: input.now, kind: 'work.claimed', actor: input.owner, payload: { workId: input.id, until: input.until, paths: reserved.leases?.map((l) => l.path) ?? [] } });
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
  requireInstant(input.now, 'work.takeover.now');
  return store.transaction(() => {
    const row = rowOf(store, input.id);
    if (!row) throw new Error(`no work ${input.id}`);
    const current = toWork(row);
    if (TERMINAL.includes(current.status)) throw new Error(`work ${input.id} is ${current.status}`);
    const live = liveClaim(row, input.now);
    const offer = openOffer(row, input.now);
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
      const parentReclaim = input.session !== undefined && row.claim_session === input.session && input.agent === 'main' && row.claim_agent !== 'main';
      if (!parentReclaim) {
        if (!row.claim_session) {
          throw new Error(`work ${input.id} is held by ${row.claim_owner} until ${row.claim_until} with no session to check; it frees itself then`);
        }
        const holder = store.db.prepare('SELECT last_seen_at, ended_at, pid, machine FROM sessions WHERE id = ?').get(row.claim_session) as
          | { last_seen_at: string; ended_at: string | null; pid: number | null; machine: string }
          | undefined;
        const quietSince = holder ? Date.parse(input.now) - Date.parse(holder.last_seen_at) : 0;
        const processGone = holder !== undefined && holder.pid !== null && input.processAlive?.(holder.pid, holder.machine) === false;
        const gone = holder !== undefined && (holder.ended_at !== null || processGone || quietSince > (input.quietCapMs ?? CLAIM_QUIET_CAP_MS));
        if (!gone) {
          throw new Error(`work ${input.id} is held by ${row.claim_owner} until ${row.claim_until}, and that session is still active; it cannot be taken over yet`);
        }
      }
    }
    const token = randomUUID();
    setClaim(store, input.id, input, token, input.until, input.now);
    takeHandoff(store, row, input.owner, input.now, 'takeover');
    // A live holder's reservations move to the taker; an expired claim's ended with it.
    const moved = live
      ? transferPaths(store, { workId: input.id, sessionId: input.session ?? input.owner, agent: input.agent ?? null, laneRoot: laneKey(input.lane), branch: input.branch, until: input.until, now: input.now })
      : { leases: [], dropped: [] };
    if (!live) releasePaths(store, { workId: input.id, now: input.now, reason: 'claim expired before the takeover' });
    recordEvent(store, input.id, input.now, 'taken_over', input.owner, current.revision + 1, { from: row.claim_owner, reason: input.reason });
    appendActivity(store, { at: input.now, kind: 'work.taken_over', actor: input.owner, payload: { workId: input.id, from: row.claim_owner, reason: input.reason } });
    return withMoved(store, withToken(getWork(store, input.id)!, token), moved, laneKey(input.lane), input.now);
  });
}

/**
 * A claim that inherited reservations, with what it now holds, what was
 * released because another claim holds it in this checkout, and what overlaps
 * reservations in other worktrees.
 */
function withMoved(store: StateStore, claimed: ClaimedWork, moved: { readonly leases: readonly PathLease[]; readonly dropped: readonly Overlap[] }, lane: string, now: string): ClaimedWork {
  if (moved.leases.length === 0 && moved.dropped.length === 0) return claimed;
  const mergeRisks = moved.leases.length === 0
    ? []
    : findOverlaps(store, { paths: moved.leases.map((l) => l.path), laneRoot: lane, now, mode: moved.leases[0]!.mode, excludeWorkId: claimed.id }).filter((o) => o.kind === 'merge_risk');
  return { ...claimed, leases: moved.leases, dropped: moved.dropped, mergeRisks };
}

/**
 * How long an offered handoff holds the work and its reservations for the next
 * holder. The offering session's own calls keep renewing it as usual.
 */
export const HANDOFF_HOLD_MS = 2 * 60 * 60_000;

/** An offer still waiting: the claim is live, still the offerer's, and nobody has taken it. */
function openOffer(row: Row, now: string): Handoff | null {
  const h = parseHandoff(row.handoff_json);
  if (!h || h.takenBy !== null || !liveClaim(row, now) || row.claim_owner !== h.from) return null;
  return h;
}

/** Record who took on handed-off work when it was claimed or taken over rather than accepted. */
function takeHandoff(store: StateStore, row: Row, owner: string, now: string, via: 'claim' | 'takeover'): void {
  const h = parseHandoff(row.handoff_json);
  if (!h || h.takenBy !== null) return;
  store.db.prepare('UPDATE work_items SET handoff_json = ? WHERE id = ?').run(JSON.stringify({ ...h, takenBy: owner, takenAt: now, takenVia: via }), row.id);
}

/** The latest handoff recorded on a work item: offered, taken, or lapsed. */
export function handoffOf(store: StateStore, id: string): Handoff | null {
  const row = rowOf(store, id);
  return row ? parseHandoff(row.handoff_json) : null;
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
  input: { readonly id: string; readonly owner: string; readonly token: string; readonly packet: Record<string, unknown>; readonly to?: string | null; readonly now: string },
): WorkItem & { readonly handoff: Handoff } {
  requireInstant(input.now, 'work.handoff.now');
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
    const handoff: Handoff = { from: input.owner, to, offeredAt: input.now, packet, takenBy: null, takenAt: null, takenVia: null };
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
export function acceptWork(
  store: StateStore,
  input: Claimant & { readonly id: string; readonly until: string; readonly now: string; readonly branch?: string | null },
): ClaimedWork & { readonly handoff: Handoff } {
  requireInstant(input.now, 'work.accept.now');
  if (input.until <= input.now) throw new Error('claim.until must be after now');
  return store.transaction(() => {
    const row = rowOf(store, input.id);
    if (!row) throw new Error(`no work ${input.id}`);
    const current = toWork(row);
    const h = openOffer(row, input.now);
    if (!h) {
      const left = parseHandoff(row.handoff_json);
      if (left && left.takenBy === null && !liveClaim(row, input.now) && !TERMINAL.includes(current.status)) {
        const how = row.status === 'claimed' ? 'lapsed with its claim' : 'was withdrawn when its holder released it';
        throw new Error(`the handoff of ${input.id} ${how}; claim the work instead, and its packet comes with it`);
      }
      throw new Error(`work ${input.id} has no open handoff`);
    }
    if (h.from === input.owner) throw new Error(`you offered ${input.id}; release or settle it with your token instead`);
    if (!offeredTo(h, input.owner, input.session)) throw new Error(`the handoff of ${input.id} is offered to ${h.to}`);
    const token = randomUUID();
    setClaim(store, input.id, input, token, input.until, input.now);
    const taken: Handoff = { ...h, takenBy: input.owner, takenAt: input.now, takenVia: 'accept' };
    store.db.prepare('UPDATE work_items SET handoff_json = ? WHERE id = ?').run(JSON.stringify(taken), input.id);
    const moved = transferPaths(store, { workId: input.id, sessionId: input.session ?? input.owner, agent: input.agent ?? null, laneRoot: laneKey(input.lane), branch: input.branch, until: input.until, now: input.now });
    recordEvent(store, input.id, input.now, 'handoff_accepted', input.owner, current.revision + 1, { from: h.from });
    appendActivity(store, { at: input.now, kind: 'work.handoff_accepted', actor: input.owner, payload: { workId: input.id, from: h.from } });
    return { ...withMoved(store, withToken(getWork(store, input.id)!, token), moved, laneKey(input.lane), input.now), handoff: taken };
  });
}

/**
 * Handoffs waiting to be accepted. With a claimant, only those it may accept:
 * offered to anyone, to it, or to its session, and not its own.
 */
export function listOffers(store: StateStore, now: string, who?: { readonly owner: string; readonly session?: string }): { readonly work: WorkItem; readonly handoff: Handoff }[] {
  const rows = store.db
    .prepare(`SELECT * FROM work_items WHERE status = 'claimed' AND claim_until > ? AND handoff_json IS NOT NULL ORDER BY updated_at, id`)
    .all(now) as unknown as Row[];
  const out: { work: WorkItem; handoff: Handoff }[] = [];
  for (const row of rows) {
    const h = openOffer(row, now);
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
export function renewSessionClaims(store: StateStore, input: { readonly session: string; readonly now: string; readonly termMs: number }): number {
  const until = new Date(Date.parse(input.now) + input.termMs).toISOString();
  const halfway = new Date(Date.parse(input.now) + input.termMs / 2).toISOString();
  const changed = Number(
    store.db
      .prepare(
        `UPDATE work_items SET claim_until = ?, claim_touched_at = ?
          WHERE claim_session = ? AND status = 'claimed' AND claim_until > ? AND claim_until < ?`,
      )
      .run(until, input.now, input.session, input.now, halfway).changes,
  );
  if (changed > 0) {
    store.db
      .prepare(
        `UPDATE path_leases SET until = ?
          WHERE released_at IS NULL AND work_id IN (SELECT id FROM work_items WHERE claim_session = ? AND status = 'claimed' AND claim_until = ?)`,
      )
      .run(until, input.session, until);
  }
  return changed;
}

export function releaseWork(
  store: StateStore,
  input: { readonly id: string; readonly owner: string; readonly token: string; readonly at: string },
): WorkItem {
  return store.transaction(() => {
    const row = rowOf(store, input.id);
    if (!row) throw new Error(`no work ${input.id}`);
    const current = toWork(row);
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
  input: { readonly id: string; readonly owner: string; readonly token?: string; readonly at: string; readonly reason?: string; readonly expectedRevision?: number },
): WorkItem {
  return setTerminal(store, { ...input, status: 'completed' });
}

export function cancelWork(
  store: StateStore,
  input: { readonly id: string; readonly actor: string; readonly at: string; readonly reason: string; readonly token?: string; readonly expectedRevision?: number },
): WorkItem {
  return setTerminal(store, { id: input.id, owner: input.actor, token: input.token, at: input.at, reason: input.reason, expectedRevision: input.expectedRevision, status: 'cancelled' });
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
        `work ${input.id} still has ${String(openChildren.length)} open child item(s): ${openChildren.slice(0, 5).map((c) => c.id).join(', ')}${openChildren.length > 5 ? ', …' : ''}; complete or cancel them first`,
      );
    }
    const running = attempts.filter((c) => liveClaim(rowOf(store, c.id)!, input.at));
    if (running.length > 0) {
      throw new Error(`work ${input.id} has a delegated attempt still running (${running.map((c) => c.id).join(', ')}); cancel it or let it finish first`);
    }
    if (input.status === 'completed' && acceptanceOf(current).length > 0 && !input.reason?.trim()) {
      throw new Error(`work ${input.id} has acceptance criteria; say how they were met in the reason`);
    }
    // A live claim is settled only with its token; a claim that expired no
    // longer protects anything.
    if (liveClaim(row, input.at) && (input.token !== row.claim_token || input.owner !== row.claim_owner)) {
      throw new Error(`work ${input.id} is held by ${row.claim_owner} until ${row.claim_until}; ${input.token ? 'that owner and token do not hold it' : 'settle it with the token its claim returned, or take it over once it is free'}`);
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
}

export function exportWork(store: StateStore, at: string, projectId: string | null): WorkExport {
  return {
    format: 'construct-work-export',
    formatVersion: 1,
    exportedAt: at,
    projectId,
    // A snapshot is shared and kept; a live claim's secret never goes into one.
    work: (store.db.prepare('SELECT * FROM work_items ORDER BY created_at, id').all() as Array<Record<string, unknown>>).map((row) => ({ ...row, claim_token: null })),
    dependencies: store.db.prepare('SELECT * FROM work_dependencies ORDER BY created_at, id').all(),
    // Claim events written before tokens were secrets carry the token in their
    // payload; a snapshot keeps the event and drops the token.
    events: (store.db.prepare('SELECT work_id, at, kind, actor, expected_revision, payload_json FROM work_events ORDER BY id').all() as Array<{ payload_json: string | null }>).map((row) => {
      const payload = parseJson(row.payload_json);
      if (!payload || typeof payload !== 'object' || !('token' in payload)) return row;
      const { token: _token, ...rest } = payload as Record<string, unknown>;
      return { ...row, payload_json: toJson(rest) };
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
    throw new Error(`this snapshot was taken from project ${dump.projectId}; this project is ${projectId}. Work moves between separate projects as new items, not as a restore.`);
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
