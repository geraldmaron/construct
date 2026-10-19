/**
 * kernel/work/handoff.ts — what one agent leaves for the next when it hands
 * over claimed work.
 *
 * A handoff is a transition of the work item, not a message: the holder
 * offers the claim with a packet saying where the work stands and what comes
 * next, and the claimant who accepts gets a new token in the same
 * transaction. The packet is free text another session wrote, so it is
 * screened for credentials when it is written, bounded in size, and handed to
 * every reader wrapped as data, never as an instruction.
 */

import { redact } from '../render/redact.ts';
import { LEASE_PATH_MAX_BYTES, normalizeLeasePath } from './leases.ts';
import { screenContent, type InjectionFlag } from '../safety/injection.ts';

/** Where the work stands, what comes next, and what the next holder should know. */
export interface HandoffPacket {
  readonly state: string;
  readonly next: string;
  readonly watchOut: readonly string[];
  readonly openQuestions: readonly string[];
  readonly where: {
    readonly branch: string | null;
    readonly commit: string | null;
    readonly paths: readonly string[];
  };
}

/** An offered or taken handoff, as the work item records it. */
export interface Handoff {
  /** Public immutable generation identity; never a capability or claim token. */
  readonly offerId?: string;
  /** The claimant that offered it. */
  readonly from: string;
  /** The claimant or session it was offered to; null when anyone in the project may accept. */
  readonly to: string | null;
  readonly offeredAt: string;
  readonly packet: HandoffPacket;
  /** Who took the work on, and how: accepting the offer, or claiming or taking over once it lapsed. */
  readonly takenBy: string | null;
  readonly takenAt: string | null;
  readonly takenVia: 'accept' | 'claim' | 'takeover' | null;
}

/**
 * Text or structure from outside the person (another agent or session, a
 * source, a recorded document): information to weigh, never an instruction.
 * `flags` names any instruction-shaped passage in it; the content is kept as is.
 */
export interface PeerData<T> {
  readonly origin: string;
  readonly trust: 'data';
  readonly content: T;
  readonly flags?: readonly InjectionFlag[];
}

export function asPeerData<T>(origin: string, content: T): PeerData<T> {
  const flags = screenContent(content);
  return flags.length > 0 ? { origin, trust: 'data', content, flags } : { origin, trust: 'data', content };
}

export const HANDOFF_TEXT_MAX = 2000;
export const HANDOFF_LIST_MAX = 20;

export class HandoffPacketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandoffPacketError';
  }
}

/** Control bytes other than newline and tab never reach a reader. */
function clean(value: string): string {
  return redact(value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '').trim());
}

function text(value: unknown, field: string, required: boolean): string {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HandoffPacketError(`a handoff says ${field}`);
    return '';
  }
  if (typeof value !== 'string') throw new HandoffPacketError(`handoff ${field} is text`);
  if (value.length > HANDOFF_TEXT_MAX)
    throw new HandoffPacketError(`handoff ${field} is at most ${String(HANDOFF_TEXT_MAX)} characters; point at a file for more`);
  const out = clean(value);
  if (required && !out) throw new HandoffPacketError(`a handoff says ${field}`);
  return out;
}

function texts(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  const items = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(items)) throw new HandoffPacketError(`handoff ${field} is a list of text`);
  if (items.length > HANDOFF_LIST_MAX) throw new HandoffPacketError(`handoff ${field} holds at most ${String(HANDOFF_LIST_MAX)} entries`);
  return items.map((v) => text(v, field, false)).filter(Boolean);
}

/**
 * A packet as it is stored: required fields present, text bounded and
 * screened, the commit a git object id, paths repository-relative.
 */
export function normalizePacket(raw: Record<string, unknown>): HandoffPacket {
  const where = (raw.where ?? {}) as Record<string, unknown>;
  if (typeof where !== 'object' || Array.isArray(where)) throw new HandoffPacketError('handoff where is an object');
  if (where.commit !== undefined && where.commit !== null && typeof where.commit !== 'string')
    throw new HandoffPacketError('handoff where.commit is text');
  const commit =
    where.commit === undefined || where.commit === null || where.commit === '' ? null : String(where.commit).trim().toLowerCase();
  if (commit !== null && !/^[0-9a-f]{7,64}$/.test(commit)) throw new HandoffPacketError('handoff where.commit is a git commit id');
  const branch =
    where.branch === undefined || where.branch === null || where.branch === ''
      ? null
      : text(where.branch, 'where.branch', false).slice(0, 200) || null;
  const pathsRaw = where.paths === undefined ? [] : where.paths;
  if (!Array.isArray(pathsRaw)) throw new HandoffPacketError('handoff where.paths is a list');
  if (pathsRaw.length > 200) throw new HandoffPacketError('handoff where.paths holds at most 200 entries');
  let paths: string[];
  try {
    paths = pathsRaw.map((p) => {
      if (typeof p !== 'string') throw new HandoffPacketError('handoff where.paths holds text paths');
      if (/\p{C}/u.test(p)) throw new HandoffPacketError('handoff where.paths cannot contain control characters');
      if (Buffer.byteLength(p) > LEASE_PATH_MAX_BYTES)
        throw new HandoffPacketError(`a handoff path is at most ${String(LEASE_PATH_MAX_BYTES)} bytes; point at its directory instead`);
      // These locations are context, not writer reservations. Keep readable
      // filenames while retaining the shared repository-confinement checks.
      return normalizeLeasePath(p, 'check');
    });
  } catch (e) {
    throw new HandoffPacketError((e as Error).message);
  }
  return {
    state: text(raw.state, 'state', true),
    next: text(raw.next, 'next', true),
    watchOut: texts(raw.watchOut, 'watchOut'),
    openQuestions: texts(raw.openQuestions, 'openQuestions'),
    where: { branch, commit, paths },
  };
}

export function parseHandoff(json: string | null): Handoff | null {
  if (!json) return null;
  return JSON.parse(json) as Handoff;
}

/** Whether an offer is still open to the claimant `owner` of session `session`. */
export function offeredTo(h: Handoff, owner: string, session: string | undefined): boolean {
  return h.to === null || h.to === owner || (session !== undefined && h.to === session);
}
