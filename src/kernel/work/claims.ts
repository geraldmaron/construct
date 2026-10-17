import { type StateStore } from '../state/open.ts';
import { leasesFor, releasePaths, transferPaths } from './leases.ts';
import { randomUUID } from 'node:crypto';
import { appendActivity } from '../state/activity.ts';
import { requireNonEmpty, canonicalInstant } from '../state/rows.ts';
import { offeredTo } from './handoff.ts';
import {
  type Claimant,
  type Reservation,
  type ClaimedWork,
  claimBounds,
  rowOf,
  toWork,
  TERMINAL,
  liveClaim,
  laneKey,
  setClaim,
  extendPaths,
  recordEvent,
  withToken,
  getWork,
  reserveFor,
  requireReadyForClaim,
  takeHandoff,
  openOffer,
  withMoved,
  type WorkItem,
} from './helpers.ts';

/** How long a holder may go without any Construct call before its claim can be taken over. */
export const CLAIM_QUIET_CAP_MS = 2 * 60 * 60_000;

/** How the caller can recover work one of its own session's agents holds: the session's main agent takes it back. */
function ownSessionRecovery(
  row: { claim_session: string | null; claim_agent: string | null },
  caller: { session?: string; agent?: string },
): string {
  if (!caller.session || row.claim_session !== caller.session || row.claim_agent === 'main') return '';
  return caller.agent === 'main'
    ? '; it is held by an agent of this session, so take it back with takeover and a reason'
    : "; it is held by an agent of this session, so this session's main agent can take it back with takeover and a reason";
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
        throw new Error(`work ${input.id} is claimed by ${row.claim_owner} until ${row.claim_until}${ownSessionRecovery(row, input)}`);
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
            `work ${input.id} is held by ${row.claim_owner} until ${row.claim_until}, and that session is still active; it cannot be taken over yet${ownSessionRecovery(row, input)}`,
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
