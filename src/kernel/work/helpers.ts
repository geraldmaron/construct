import { parseJson, toJson, requireNonEmpty, canonicalInstant } from '../state/rows.ts';
import { type StateStore } from '../state/open.ts';
import { type PathLease, type Overlap, type LeaseMode, type CrossLanePolicy, MAIN_LANE, reservePaths, findOverlaps } from './leases.ts';
import { type Handoff, parseHandoff } from './handoff.ts';
import { createHash } from 'node:crypto';

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

export const TERMINAL: readonly WorkStatus[] = ['completed', 'cancelled', 'superseded', 'historical'];

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

export interface Row {
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

export function toWork(row: Row): WorkItem {
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

export function getWork(store: StateStore, id: string): WorkItem | null {
  const row = store.db.prepare('SELECT * FROM work_items WHERE id = ?').get(id) as Row | undefined;
  return row ? toWork(row) : null;
}

export function getWorkByLegacyId(store: StateStore, legacyId: string): WorkItem | null {
  const map = store.db.prepare('SELECT work_id FROM work_legacy_ids WHERE legacy_id = ?').get(legacyId) as { work_id: string } | undefined;
  return map ? getWork(store, map.work_id) : null;
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

export function wouldCycle(store: StateStore, fromId: string, toId: string, kind: WorkDepKind): boolean {
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

export function isStale(premises: unknown): boolean {
  return premises !== null && typeof premises === 'object' && (premises as { stale?: unknown }).stale === true;
}

export function staleMark(premises: unknown): { stale: true; staleSource: unknown; staleAt: unknown } {
  const p = premises as { staleSource?: unknown; staleAt?: unknown };
  return { stale: true, staleSource: p.staleSource ?? null, staleAt: p.staleAt ?? null };
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
export function laneKey(lane: string | undefined): string {
  return lane ?? MAIN_LANE;
}

/** Who is claiming: the owner string of record, and the session, agent, and lane behind it. */
export interface Claimant {
  readonly owner: string;
  readonly session?: string;
  readonly agent?: string;
  readonly lane?: string;
}

export function liveClaim(row: Row, now: string): boolean {
  return row.status === 'claimed' && row.claim_owner !== null && row.claim_until !== null && row.claim_until > now;
}

export function isDelegationAttempt(store: StateStore, id: string): boolean {
  return (
    store.db.prepare('SELECT 1 FROM work_events WHERE work_id = ? AND kind = ? LIMIT 1').get(id, DELEGATION_ATTEMPT_EVENT) !== undefined
  );
}

export function rowOf(store: StateStore, id: string): Row | null {
  return (store.db.prepare('SELECT * FROM work_items WHERE id = ?').get(id) as Row | undefined) ?? null;
}

export function withToken(item: WorkItem, token: string): ClaimedWork {
  return { ...item, claimToken: token };
}

export function setClaim(store: StateStore, id: string, who: Claimant, token: string, until: string, now: string): void {
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
export function claimBounds<T extends { readonly owner: string; readonly now: string; readonly until: string }>(input: T): T {
  requireNonEmpty(input.owner, 'claim.owner');
  const now = canonicalInstant(input.now, 'claim.now');
  const until = canonicalInstant(input.until, 'claim.until');
  if (until <= now) throw new Error('claim.until must be after now');
  return { ...input, now, until };
}

export function requireReadyForClaim(store: StateStore, current: WorkItem, now: string): void {
  const ready = readinessOf(store, { ...current, claimOwner: null, claimUntil: null }, now);
  if (!ready.ready) throw new Error(`work ${current.id} is not ready: ${ready.blockers.join('; ')}`);
}

/** Keep a work item's reservations' recorded term in step with its claim. */
export function extendPaths(store: StateStore, workId: string, until: string): void {
  store.db.prepare('UPDATE path_leases SET until = ? WHERE work_id = ? AND released_at IS NULL').run(until, workId);
}

/** Reserve the paths a claim names, if any; a collision throws and rolls the claim back. */
export function reserveFor(
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
 * A claim that inherited reservations, with what it now holds, what was
 * released because another claim holds it in this checkout, and what overlaps
 * reservations in other worktrees.
 */
export function withMoved(
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

/** An offer still waiting: the claim is live, still the offerer's, and nobody has taken it. */
export function identifiedHandoff(store: StateStore, id: string, h: Handoff): Handoff {
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

export function openOffer(store: StateStore, row: Row, now: string): Handoff | null {
  const h = parseHandoff(row.handoff_json);
  if (!h || h.takenBy !== null || !liveClaim(row, now) || row.claim_owner !== h.from) return null;
  return identifiedHandoff(store, row.id, h);
}

/** Record who took on handed-off work when it was claimed or taken over rather than accepted. */
export function takeHandoff(store: StateStore, row: Row, owner: string, now: string, via: 'claim' | 'takeover'): void {
  const h = parseHandoff(row.handoff_json);
  if (!h || h.takenBy !== null) return;
  store.db
    .prepare('UPDATE work_items SET handoff_json = ? WHERE id = ?')
    .run(JSON.stringify({ ...h, takenBy: owner, takenAt: now, takenVia: via }), row.id);
}

/** The reservation a managed run holds for its requested artifact. It is the run's to settle, never a host's to claim. */
export function isRunDelivery(work: Pick<WorkItem, 'scope'>): boolean {
  return (work.scope as { kind?: unknown } | null)?.kind === 'managed_delivery';
}
