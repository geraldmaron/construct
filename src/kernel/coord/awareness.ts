/**
 * kernel/coord/awareness.ts — what one session knows about the others working
 * in the same project.
 *
 * Construct cannot interrupt a model mid-turn, so awareness rides on the
 * calls a session already makes: bootstrap says who else is here and warns
 * when another session edits the same checkout, and any later result carries
 * what other sessions did to work since this session last looked. Both carry
 * facts only: ids, holders, paths, states, and times. Titles, reasons, and
 * handoff packets are other agents' words and stay behind `work show`, where
 * they arrive wrapped as data.
 */

import type { StateStore } from '../state/open.ts';
import { listLiveSessions, type SessionRecord } from '../state/sessions.ts';
import { listOffers } from '../work/service.ts';
import { MAIN_LANE } from '../work/leases.ts';
import { asPeerData, type PeerData } from '../work/handoff.ts';

/** A session that called Construct within this window counts as present. */
export const PRESENT_WITHIN_MS = 30 * 60_000;

/** The most either summary may add to a result, in serialized bytes. */
export const AWARENESS_BUDGET = 600;

/** Work events other sessions should hear about. */
const PEER_KINDS = ['work.claimed', 'work.completed', 'work.cancelled', 'work.taken_over', 'work.handoff_offered', 'work.handoff_accepted'] as const;

export interface PresentSession {
  readonly id: string;
  readonly host: string;
  readonly client: string | null;
  readonly lane: string;
  readonly branch: string | null;
  readonly lastSeenAt: string;
  readonly agents: readonly string[];
  /** Live work claims held by the session's agents. */
  readonly holds: number;
  readonly you: boolean;
}

function laneOf(s: SessionRecord): string {
  return s.laneRoot ?? MAIN_LANE;
}

/** Sessions that have not ended and called Construct within the presence window. */
export function presentSessions(store: StateStore, input: { readonly now: string; readonly sessionId?: string | null }): PresentSession[] {
  const since = new Date(Date.parse(input.now) - PRESENT_WITHIN_MS).toISOString();
  const agents = store.db.prepare(`SELECT agent FROM session_agents WHERE session_id = ? ORDER BY last_seen_at DESC LIMIT 20`);
  const holds = store.db.prepare(`SELECT COUNT(*) AS n FROM work_items WHERE claim_session = ? AND status = 'claimed' AND claim_until > ?`);
  return listLiveSessions(store, since).map((s) => ({
    id: s.id,
    host: s.host,
    client: s.clientName,
    lane: laneOf(s),
    branch: s.branch,
    lastSeenAt: s.lastSeenAt,
    agents: (agents.all(s.id) as { agent: string }[]).map((a) => a.agent),
    holds: Number((holds.get(s.id, input.now) as { n: number }).n),
    you: s.id === input.sessionId,
  }));
}

export interface HeldWork {
  readonly work: string;
  readonly by: string;
  readonly lane: string;
  readonly paths: readonly string[];
}

export interface Coordination {
  /** Other sessions present in the project. */
  readonly others: number;
  /** How many of them work in this same checkout. */
  readonly sameCheckout: number;
  /** Live claims other claimants hold, most recent first; `more` counts the rest. */
  readonly held: readonly HeldWork[];
  readonly more: number;
  /** Handoffs this session may accept. */
  readonly offers: number;
  readonly warning?: string;
}

function heldByOthers(store: StateStore, input: { readonly sessionId?: string | null; readonly now: string }): HeldWork[] {
  const rows = store.db
    .prepare(
      `SELECT w.id, w.claim_owner, w.claim_lane,
              (SELECT group_concat(path, char(10)) FROM (SELECT path FROM path_leases l WHERE l.work_id = w.id AND l.released_at IS NULL ORDER BY path LIMIT 4)) AS paths
         FROM work_items w
        WHERE w.status = 'claimed' AND w.claim_until > ? AND (w.claim_session IS NULL OR w.claim_session != ?)
        ORDER BY w.claim_touched_at DESC, w.id`,
    )
    .all(input.now, input.sessionId ?? '') as { id: string; claim_owner: string; claim_lane: string | null; paths: string | null }[];
  return rows.map((r) => ({ work: r.id, by: r.claim_owner, lane: r.claim_lane ?? MAIN_LANE, paths: r.paths ? r.paths.split('\n') : [] }));
}

/**
 * Who else is here and what they hold, for bootstrap. Bounded: the list of
 * held work is cut until the whole summary fits the awareness budget.
 */
export function coordinationFor(store: StateStore, input: { readonly sessionId?: string | null; readonly laneRoot?: string | null; readonly now: string }): Coordination {
  const lane = input.laneRoot ?? MAIN_LANE;
  const others = presentSessions(store, input).filter((s) => !s.you);
  const sameCheckout = others.filter((s) => s.lane === lane).length;
  const offers = input.sessionId ? listOffers(store, input.now, { owner: `${input.sessionId}/main`, session: input.sessionId }).length : 0;
  const all = heldByOthers(store, input);
  const base = {
    others: others.length,
    sameCheckout,
    offers,
    ...(sameCheckout > 0
      ? { warning: `${String(sameCheckout)} other session(s) work in this same checkout. Claim with paths before editing, and never switch branches or stash here; a git worktree per writer avoids the collision.` }
      : {}),
  };
  let held = all.slice(0, 5);
  const fits = (h: HeldWork[]): boolean => Buffer.byteLength(JSON.stringify({ ...base, held: h, more: all.length - h.length })) <= AWARENESS_BUDGET;
  while (held.length > 0 && !fits(held)) held = held.slice(0, -1);
  return { others: base.others, sameCheckout, held, more: all.length - held.length, offers, ...(base.warning ? { warning: base.warning } : {}) };
}

export interface PeerEvent {
  readonly kind: string;
  readonly work: string;
  readonly by: string | null;
  readonly at: string;
  readonly paths?: readonly string[];
}

export interface PeerDelta {
  readonly events: readonly PeerEvent[];
  readonly more: number;
  readonly offers: number;
}

/** The newest activity id, where a session starts watching. */
export function latestActivityId(store: StateStore): number {
  return Number((store.db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM activity_events').get() as { n: number }).n);
}

export function activityCursor(store: StateStore, sessionId: string): number {
  const row = store.db.prepare('SELECT activity_cursor FROM sessions WHERE id = ?').get(sessionId) as { activity_cursor: number } | undefined;
  return Number(row?.activity_cursor ?? 0);
}

export function setActivityCursor(store: StateStore, sessionId: string, cursor: number): void {
  store.db.prepare('UPDATE sessions SET activity_cursor = ? WHERE id = ? AND activity_cursor < ?').run(cursor, sessionId, cursor);
}

/**
 * What other sessions, and other agents of this one, did to work after
 * `cursor`, and the cursor to use next. The cursor is the session's, so
 * whichever of its agents calls next hears it. Null when nothing relevant
 * happened. Bounded to the awareness budget.
 */
export function peerDelta(
  store: StateStore,
  input: { readonly sessionId: string; readonly cursor: number; readonly now: string; readonly agent?: string | null },
): { readonly delta: PeerDelta | null; readonly cursor: number } {
  const latest = latestActivityId(store);
  if (latest <= input.cursor) return { delta: null, cursor: input.cursor };
  const rows = store.db
    .prepare(
      `SELECT at, kind, actor, payload_json FROM activity_events
        WHERE id > ? AND id <= ? AND (session_id IS NULL OR session_id != ? OR COALESCE(agent, 'main') != ?)
          AND kind IN (${PEER_KINDS.map(() => '?').join(', ')})
        ORDER BY id`,
    )
    .all(input.cursor, latest, input.sessionId, input.agent ?? 'main', ...PEER_KINDS) as { at: string; kind: string; actor: string | null; payload_json: string }[];
  if (rows.length === 0) return { delta: null, cursor: latest };
  const events: PeerEvent[] = rows.map((r) => {
    const p = JSON.parse(r.payload_json) as { workId?: unknown; paths?: unknown };
    const paths = Array.isArray(p.paths) ? p.paths.filter((x): x is string => typeof x === 'string').slice(0, 4) : [];
    return { kind: r.kind.slice('work.'.length), work: String(p.workId ?? ''), by: r.actor, at: r.at, ...(paths.length > 0 ? { paths } : {}) };
  });
  const offers = listOffers(store, input.now, { owner: `${input.sessionId}/main`, session: input.sessionId }).length;
  let shown = events.slice(-6);
  const fits = (e: PeerEvent[]): boolean => Buffer.byteLength(JSON.stringify({ events: e, more: events.length - e.length, offers })) <= AWARENESS_BUDGET;
  while (shown.length > 0 && !fits(shown)) shown = shown.slice(1);
  return { delta: { events: shown, more: events.length - shown.length, offers }, cursor: latest };
}

export interface RecentActivity {
  readonly id: number;
  readonly at: string;
  readonly kind: string;
  readonly sessionId: string | null;
  readonly agent: string | null;
  readonly channel: string | null;
  readonly actor: string | null;
  /** What the event recorded, as whoever recorded it said it. */
  readonly payload: PeerData<unknown>;
}

/** The latest activity, newest first, with each payload wrapped as its author's data. */
export function recentActivity(store: StateStore, limit: number): RecentActivity[] {
  const rows = store.db
    .prepare(`SELECT id, at, kind, session_id, agent, channel, actor, payload_json FROM activity_events ORDER BY id DESC LIMIT ?`)
    .all(Math.max(1, Math.min(limit, 1000))) as { id: number; at: string; kind: string; session_id: string | null; agent: string | null; channel: string | null; actor: string | null; payload_json: string }[];
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    kind: r.kind,
    sessionId: r.session_id,
    agent: r.agent,
    channel: r.channel,
    actor: r.actor,
    payload: asPeerData(r.actor ?? r.session_id ?? 'unknown', JSON.parse(r.payload_json) as unknown),
  }));
}
