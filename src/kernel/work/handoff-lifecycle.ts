import { type StateStore } from '../state/open.ts';
import { type Handoff, parseHandoff, normalizePacket, offeredTo } from './handoff.ts';
import { canonicalInstant } from '../state/rows.ts';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { appendActivity } from '../state/activity.ts';
import { type Overlap, leasesFor, transferPaths } from './leases.ts';
import {
  rowOf,
  identifiedHandoff,
  type WorkItem,
  toWork,
  liveClaim,
  extendPaths,
  recordEvent,
  getWork,
  openOffer,
  requireReadyForClaim,
  type Claimant,
  type ClaimedWork,
  claimBounds,
  laneKey,
  withMoved,
  withToken,
  TERMINAL,
  setClaim,
  type Row,
} from './helpers.ts';

/**
 * How long an offered handoff holds the work and its reservations for the next
 * holder. The offering session's own calls keep renewing it as usual.
 */
export const HANDOFF_HOLD_MS = 2 * 60 * 60_000;

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
