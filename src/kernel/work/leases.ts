/**
 * kernel/work/leases.ts — reservations on repository paths, held for a claimed
 * work item.
 *
 * Two writers on the same files is the collision parallel agents actually
 * cause. A claim may reserve the paths it will change. A reservation lives
 * exactly as long as the claim that holds it: when the claim expires, is
 * released, completes, or is taken over, the reservation goes with it. Within
 * one checkout an exclusive reservation keeps every other claim off the same
 * paths; across worktrees an overlap is a merge risk, reported with both
 * branches, because each writer has its own copy of the files.
 *
 * Paths are relative to the repository's top level. A path ending in `/` is a directory and
 * covers everything under it. Overlap is prefix containment either way, so it
 * may report an overlap that is not one but never misses one that is.
 */

import { randomUUID } from 'node:crypto';
import type { StateStore } from '../state/open.ts';

export const LEASE_MODES = ['exclusive', 'shared'] as const;
export type LeaseMode = (typeof LEASE_MODES)[number];

/** What to do when a claim's paths overlap a reservation in another worktree. */
export type CrossLanePolicy = 'warn' | 'refuse';

export interface PathLease {
  readonly id: string;
  readonly workId: string;
  readonly sessionId: string;
  readonly agent: string | null;
  readonly laneRoot: string;
  readonly branch: string | null;
  readonly path: string;
  readonly mode: LeaseMode;
  readonly createdAt: string;
}

export interface Overlap {
  /** The path asked for. */
  readonly path: string;
  /** The reserved path it overlaps. */
  readonly heldPath: string;
  readonly workId: string;
  /** Who holds it: the claim's owner. */
  readonly holder: string;
  readonly mode: LeaseMode;
  readonly until: string;
  readonly laneRoot: string;
  readonly branch: string | null;
  /** Same checkout: a real collision. Another worktree: a merge risk. */
  readonly kind: 'collision' | 'merge_risk';
}

export class PathLeaseConflictError extends Error {
  readonly overlaps: readonly Overlap[];

  constructor(overlaps: readonly Overlap[]) {
    super(
      `these paths are reserved by other work: ${overlaps
        .map((o) => `${o.path} (${o.heldPath}, held by ${o.holder} for ${o.workId} until ${o.until}${o.kind === 'merge_risk' ? `, ${whereHeld(o)}` : ''})`)
        .join('; ')}`,
    );
    this.name = 'PathLeaseConflictError';
    this.overlaps = overlaps;
  }
}

/** The checkout a merge risk sits in, in words. */
export function whereHeld(o: Pick<Overlap, 'laneRoot' | 'branch'>): string {
  const place = o.laneRoot === MAIN_LANE ? 'in the main checkout' : `in the worktree at ${o.laneRoot}`;
  return o.branch ? `${place} on ${o.branch}` : place;
}

/** How the main checkout is recorded as a reservation's lane. */
export const MAIN_LANE = 'main';

/** The longest reserved path, in bytes. */
export const LEASE_PATH_MAX_BYTES = 512;

/**
 * A repository-relative path in one spelling: forward slashes, no leading
 * `./`, no `..`, no absolute paths. A trailing `/` marks a directory.
 *
 * A path being reserved is shown to every other session, so it is held to a
 * plain spelling: no whitespace, control, or formatting characters, and at
 * most 512 bytes, which leaves no room for a sentence. A file whose name has
 * spaces is reserved through its directory. A path only being checked is not
 * shown to anyone else and keeps whatever spelling it has.
 */
export function normalizeLeasePath(raw: string, use: 'reserve' | 'check' = 'reserve'): string {
  const trimmed = raw.trim().replaceAll('\\', '/');
  if (!trimmed) throw new Error('a reserved path cannot be empty');
  if (use === 'reserve') {
    if (/[\s\p{C}]/u.test(trimmed)) throw new Error(`a reserved path is spelled without spaces or control characters; reserve the directory that holds it instead of ${JSON.stringify(trimmed.slice(0, 80))}`);
    if (Buffer.byteLength(trimmed) > LEASE_PATH_MAX_BYTES) throw new Error(`a reserved path is at most ${String(LEASE_PATH_MAX_BYTES)} bytes; reserve a directory instead`);
  }
  if (trimmed.startsWith('/') || /^[A-Za-z]:\//.test(trimmed)) throw new Error(`reserve paths relative to the repository, not ${trimmed}`);
  const directory = trimmed.endsWith('/');
  const parts = trimmed.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) throw new Error(`a reserved path stays inside the repository: ${trimmed}`);
  if (parts.length === 0) return '/';
  return parts.join('/') + (directory ? '/' : '');
}

/** Whether two normalized paths overlap: the same file, or one a directory containing the other. */
export function pathsOverlap(a: string, b: string): boolean {
  if (a === '/' || b === '/') return true;
  if (a === b) return true;
  if (a.endsWith('/') && b.startsWith(a)) return true;
  if (b.endsWith('/') && a.startsWith(b)) return true;
  return false;
}

interface LiveRow {
  readonly id: string;
  readonly work_id: string;
  readonly session_id: string;
  readonly agent: string | null;
  readonly lane_root: string;
  readonly branch: string | null;
  readonly path: string;
  readonly mode: LeaseMode;
  readonly created_at: string;
  readonly claim_owner: string;
  readonly claim_until: string;
}

/** Reservations whose claim is live at `now`. */
function liveRows(store: StateStore, now: string): LiveRow[] {
  return store.db
    .prepare(
      `SELECT l.id, l.work_id, l.session_id, l.agent, l.lane_root, l.branch, l.path, l.mode, l.created_at,
              w.claim_owner, w.claim_until
         FROM path_leases l JOIN work_items w ON w.id = l.work_id
        WHERE l.released_at IS NULL AND w.status = 'claimed' AND w.claim_until > ?
        ORDER BY l.created_at, l.id`,
    )
    .all(now) as unknown as LiveRow[];
}

/** Every live reservation, for awareness. */
export function listLiveLeases(store: StateStore, now: string): PathLease[] {
  return liveRows(store, now).map(toLease);
}

/**
 * Where `paths` overlap live reservations held for other work. A reservation
 * in the same checkout is a collision when either side is exclusive; one in
 * another worktree is a merge risk. Overlap is judged per work item, never per
 * owner: two agents a host cannot tell apart share an owner name and are still
 * two writers.
 */
export function findOverlaps(
  store: StateStore,
  input: { readonly paths: readonly string[]; readonly laneRoot: string; readonly now: string; readonly mode?: LeaseMode; readonly excludeWorkId?: string },
): Overlap[] {
  const wanted = input.paths.map((p) => normalizeLeasePath(p, 'check'));
  const mode = input.mode ?? 'exclusive';
  const out: Overlap[] = [];
  for (const row of liveRows(store, input.now)) {
    if (row.work_id === input.excludeWorkId) continue;
    for (const path of wanted) {
      if (!pathsOverlap(path, row.path)) continue;
      const sameLane = row.lane_root === input.laneRoot;
      if (sameLane && mode === 'shared' && row.mode === 'shared') continue;
      out.push({
        path,
        heldPath: row.path,
        workId: row.work_id,
        holder: row.claim_owner,
        mode: row.mode,
        until: row.claim_until,
        laneRoot: row.lane_root,
        branch: row.branch,
        kind: sameLane ? 'collision' : 'merge_risk',
      });
    }
  }
  return out;
}

/**
 * Reserve `paths` for a claimed work item. Refuses when any path collides
 * with another claim's reservation in the same checkout, and, under the
 * `refuse` policy, when it overlaps one in another worktree. Returns the merge
 * risks it accepted. Runs inside the caller's claim transaction.
 */
export function reservePaths(
  store: StateStore,
  input: {
    readonly workId: string;
    readonly sessionId: string;
    readonly agent: string | null;
    readonly laneRoot: string;
    readonly branch: string | null;
    readonly paths: readonly string[];
    readonly mode: LeaseMode;
    readonly until: string;
    readonly now: string;
    readonly crossLane?: CrossLanePolicy;
  },
): { readonly leases: readonly PathLease[]; readonly mergeRisks: readonly Overlap[] } {
  const paths = [...new Set(input.paths.map((p) => normalizeLeasePath(p)))];
  if (paths.length === 0) return { leases: [], mergeRisks: [] };
  const overlaps = findOverlaps(store, { paths, laneRoot: input.laneRoot, now: input.now, mode: input.mode, excludeWorkId: input.workId });
  const blocking = overlaps.filter((o) => o.kind === 'collision' || input.crossLane === 'refuse');
  if (blocking.length > 0) throw new PathLeaseConflictError(blocking);
  releasePaths(store, { workId: input.workId, now: input.now, reason: 'claimed again' });
  const insert = store.db.prepare(
    `INSERT INTO path_leases (id, work_id, session_id, agent, lane_root, branch, path, mode, token, created_at, until)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const leases: PathLease[] = [];
  for (const path of paths) {
    const id = `lease-${randomUUID()}`;
    insert.run(id, input.workId, input.sessionId, input.agent, input.laneRoot, input.branch, path, input.mode, randomUUID(), input.now, input.until);
    leases.push({ id, workId: input.workId, sessionId: input.sessionId, agent: input.agent, laneRoot: input.laneRoot, branch: input.branch, path, mode: input.mode, createdAt: input.now });
  }
  return { leases, mergeRisks: overlaps.filter((o) => o.kind === 'merge_risk') };
}

/** Release every reservation held for a work item. */
export function releasePaths(store: StateStore, input: { readonly workId: string; readonly now: string; readonly reason: string }): number {
  return Number(
    store.db
      .prepare(`UPDATE path_leases SET released_at = ?, release_reason = ? WHERE work_id = ? AND released_at IS NULL`)
      .run(input.now, input.reason, input.workId).changes,
  );
}

/**
 * Move a work item's reservations to a new holder, for a takeover or an
 * accepted handoff. A reservation that would collide with another claim's in
 * the new holder's checkout is released rather than moved, so no checkout
 * ever has two exclusive holders of one path; those come back as `dropped`.
 */
export function transferPaths(
  store: StateStore,
  input: { readonly workId: string; readonly sessionId: string; readonly agent: string | null; readonly laneRoot: string; readonly branch?: string | null; readonly until: string; readonly now: string },
): { readonly leases: PathLease[]; readonly dropped: Overlap[] } {
  const dropped: Overlap[] = [];
  const release = store.db.prepare(`UPDATE path_leases SET released_at = ?, release_reason = ? WHERE id = ?`);
  for (const lease of leasesFor(store, input.workId)) {
    const collisions = findOverlaps(store, { paths: [lease.path], laneRoot: input.laneRoot, now: input.now, mode: lease.mode, excludeWorkId: input.workId }).filter((o) => o.kind === 'collision');
    if (collisions.length === 0) continue;
    release.run(input.now, 'held by other work in the new checkout', lease.id);
    dropped.push(...collisions);
  }
  store.db
    .prepare(
      `UPDATE path_leases SET session_id = ?, agent = ?, lane_root = ?, branch = ?, until = ?
        WHERE work_id = ? AND released_at IS NULL`,
    )
    .run(input.sessionId, input.agent, input.laneRoot, input.branch ?? null, input.until, input.workId);
  return { leases: leasesFor(store, input.workId), dropped };
}

/** A work item's unreleased reservations. */
export function leasesFor(store: StateStore, workId: string): PathLease[] {
  const rows = store.db
    .prepare(
      `SELECT id, work_id, session_id, agent, lane_root, branch, path, mode, created_at
         FROM path_leases WHERE work_id = ? AND released_at IS NULL ORDER BY path`,
    )
    .all(workId) as unknown as Omit<LiveRow, 'title' | 'claim_owner' | 'claim_until'>[];
  return rows.map(toLease);
}

function toLease(r: Omit<LiveRow, 'title' | 'claim_owner' | 'claim_until'>): PathLease {
  return { id: r.id, workId: r.work_id, sessionId: r.session_id, agent: r.agent, laneRoot: r.lane_root, branch: r.branch, path: r.path, mode: r.mode, createdAt: r.created_at };
}
