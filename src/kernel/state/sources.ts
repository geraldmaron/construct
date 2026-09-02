/**
 * kernel/state/sources.ts — sources, per-claim-type authority, and snapshots.
 *
 * A source is authoritative for the claim types it is declared authoritative
 * for, and explicitly not for the ones marked 0. Snapshots are recorded by
 * digest so a refresh that finds the same bytes records nothing new.
 */

import type { StateStore } from './open.ts';
import {
  boolFrom,
  parseJson,
  requireInstant,
  requireNonEmpty,
  requireOneOf,
  toJson,
} from './rows.ts';

export const AUTHORITY_LEVELS = ['authoritative', 'informative', 'untrusted'] as const;
export type AuthorityLevel = (typeof AUTHORITY_LEVELS)[number];

export const SENSITIVITIES = ['public', 'internal', 'confidential', 'restricted'] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export const REACHABILITIES = ['unknown', 'reachable', 'unreachable'] as const;
export type Reachability = (typeof REACHABILITIES)[number];

export const SOURCE_ORIGINS = ['declared', 'local'] as const;
export type SourceOrigin = (typeof SOURCE_ORIGINS)[number];

export interface Source {
  readonly id: string;
  readonly kind: string;
  /** declared: from the committed sources file; local: added in this checkout only. */
  readonly origin: SourceOrigin;
  readonly purpose: string;
  readonly locator: string | null;
  readonly authorityLevel: AuthorityLevel;
  readonly freshnessHours: number | null;
  readonly sensitivity: Sensitivity;
  readonly retention: string | null;
  readonly canRead: boolean;
  readonly canWrite: boolean;
  readonly identityMapping: unknown;
  readonly reachability: Reachability;
  readonly lastSnapshotId: string | null;
  readonly status: 'active' | 'retired';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly retiredAt: string | null;
}

interface Row {
  readonly id: string;
  readonly kind: string;
  readonly origin: SourceOrigin;
  readonly purpose: string;
  readonly locator: string | null;
  readonly authority_level: AuthorityLevel;
  readonly freshness_hours: number | null;
  readonly sensitivity: Sensitivity;
  readonly retention: string | null;
  readonly can_read: number;
  readonly can_write: number;
  readonly identity_mapping_json: string | null;
  readonly reachability: Reachability;
  readonly last_snapshot_id: string | null;
  readonly status: 'active' | 'retired';
  readonly created_at: string;
  readonly updated_at: string;
  readonly retired_at: string | null;
}

function toSource(row: Row): Source {
  return {
    id: row.id,
    kind: row.kind,
    origin: row.origin,
    purpose: row.purpose,
    locator: row.locator,
    authorityLevel: row.authority_level,
    freshnessHours: row.freshness_hours,
    sensitivity: row.sensitivity,
    retention: row.retention,
    canRead: boolFrom(row.can_read),
    canWrite: boolFrom(row.can_write),
    identityMapping: parseJson(row.identity_mapping_json),
    reachability: row.reachability,
    lastSnapshotId: row.last_snapshot_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    retiredAt: row.retired_at,
  };
}

export interface AddSourceInput {
  readonly id: string;
  readonly kind: string;
  /** Defaults to local: a source only this checkout knows about. */
  readonly origin?: SourceOrigin;
  readonly purpose: string;
  readonly locator?: string;
  readonly authorityLevel: AuthorityLevel;
  readonly freshnessHours?: number;
  readonly sensitivity: Sensitivity;
  readonly retention?: string;
  readonly canRead: boolean;
  readonly canWrite: boolean;
  readonly identityMapping?: unknown;
  /** Claim types this source is authoritative for. */
  readonly authoritativeFor?: readonly string[];
  /** Claim types this source is explicitly not authoritative for. */
  readonly notAuthoritativeFor?: readonly string[];
  readonly at: string;
}

export function addSource(store: StateStore, input: AddSourceInput): Source {
  requireNonEmpty(input.id, 'source.id');
  requireNonEmpty(input.kind, 'source.kind');
  requireNonEmpty(input.purpose, 'source.purpose');
  requireOneOf(input.authorityLevel, AUTHORITY_LEVELS, 'source.authorityLevel');
  requireOneOf(input.sensitivity, SENSITIVITIES, 'source.sensitivity');
  const origin = input.origin ?? 'local';
  requireOneOf(origin, SOURCE_ORIGINS, 'source.origin');
  requireInstant(input.at, 'source.at');
  if (input.freshnessHours !== undefined && !(input.freshnessHours > 0)) {
    throw new Error('source.freshnessHours must be a positive number of hours');
  }
  const overlap = (input.authoritativeFor ?? []).filter((t) =>
    (input.notAuthoritativeFor ?? []).includes(t),
  );
  if (overlap.length > 0) {
    throw new Error(
      `source ${input.id} cannot be both authoritative and not authoritative for ${overlap.join(', ')}`,
    );
  }
  return store.transaction(() => {
    const row = store.db
      .prepare(
        `INSERT INTO sources
           (id, kind, origin, purpose, locator, authority_level, freshness_hours, sensitivity, retention,
            can_read, can_write, identity_mapping_json, reachability, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', 'active', ?, ?) RETURNING *`,
      )
      .get(
        input.id,
        input.kind,
        origin,
        input.purpose,
        input.locator ?? null,
        input.authorityLevel,
        input.freshnessHours ?? null,
        input.sensitivity,
        input.retention ?? null,
        input.canRead ? 1 : 0,
        input.canWrite ? 1 : 0,
        input.identityMapping === undefined ? null : toJson(input.identityMapping),
        input.at,
        input.at,
      ) as unknown as Row;
    for (const claimType of input.authoritativeFor ?? []) {
      setAuthority(store, input.id, claimType, true);
    }
    for (const claimType of input.notAuthoritativeFor ?? []) {
      setAuthority(store, input.id, claimType, false);
    }
    return toSource(row);
  });
}

export interface UpdateSourceInput {
  readonly purpose?: string;
  readonly locator?: string | null;
  readonly authorityLevel?: AuthorityLevel;
  readonly freshnessHours?: number | null;
  readonly sensitivity?: Sensitivity;
  readonly retention?: string | null;
  readonly canRead?: boolean;
  readonly canWrite?: boolean;
  readonly identityMapping?: unknown;
}

/** Patch a source's declaration fields. Omitted fields are kept. */
export function updateSource(store: StateStore, id: string, patch: UpdateSourceInput, at: string): Source {
  requireInstant(at, 'source.at');
  if (patch.authorityLevel !== undefined) requireOneOf(patch.authorityLevel, AUTHORITY_LEVELS, 'source.authorityLevel');
  if (patch.sensitivity !== undefined) requireOneOf(patch.sensitivity, SENSITIVITIES, 'source.sensitivity');
  if (patch.freshnessHours !== undefined && patch.freshnessHours !== null && !(patch.freshnessHours > 0)) {
    throw new Error('source.freshnessHours must be a positive number of hours');
  }
  return store.transaction(() => {
    const current = getSource(store, id);
    if (!current) throw new Error(`no source ${id}`);
    store.db
      .prepare(
        `UPDATE sources SET purpose = ?, locator = ?, authority_level = ?, freshness_hours = ?, sensitivity = ?,
                retention = ?, can_read = ?, can_write = ?, identity_mapping_json = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        patch.purpose ?? current.purpose,
        patch.locator === undefined ? current.locator : patch.locator,
        patch.authorityLevel ?? current.authorityLevel,
        patch.freshnessHours === undefined ? current.freshnessHours : patch.freshnessHours,
        patch.sensitivity ?? current.sensitivity,
        patch.retention === undefined ? current.retention : patch.retention,
        (patch.canRead ?? current.canRead) ? 1 : 0,
        (patch.canWrite ?? current.canWrite) ? 1 : 0,
        patch.identityMapping === undefined
          ? (current.identityMapping === null ? null : toJson(current.identityMapping))
          : toJson(patch.identityMapping),
        at,
        id,
      );
    return getSource(store, id)!;
  });
}

export function getSource(store: StateStore, id: string): Source | null {
  const row = store.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as Row | undefined;
  return row ? toSource(row) : null;
}

export function listSources(
  store: StateStore,
  filter: { readonly status?: 'active' | 'retired' } = {},
): Source[] {
  const rows = store.db
    .prepare(`SELECT * FROM sources WHERE (? IS NULL OR status = ?) ORDER BY created_at, id`)
    .all(filter.status ?? null, filter.status ?? null) as unknown as Row[];
  return rows.map(toSource);
}

export function retireSource(store: StateStore, id: string, at: string): Source {
  requireInstant(at, 'source.at');
  const result = store.db
    .prepare(
      `UPDATE sources SET status = 'retired', retired_at = ?, updated_at = ? WHERE id = ? AND status = 'active'`,
    )
    .run(at, at, id);
  if (result.changes === 0) throw new Error(`no active source ${id} to retire`);
  return getSource(store, id)!;
}

export function setReachability(
  store: StateStore,
  id: string,
  reachability: Reachability,
  at: string,
): Source {
  requireOneOf(reachability, REACHABILITIES, 'source.reachability');
  requireInstant(at, 'source.at');
  const result = store.db
    .prepare('UPDATE sources SET reachability = ?, updated_at = ? WHERE id = ?')
    .run(reachability, at, id);
  if (result.changes === 0) throw new Error(`no source ${id}`);
  return getSource(store, id)!;
}

export function setAuthority(
  store: StateStore,
  sourceId: string,
  claimType: string,
  authoritative: boolean,
): void {
  requireNonEmpty(claimType, 'authority.claimType');
  const result = store.db
    .prepare(
      `INSERT INTO source_authority (source_id, claim_type, authoritative) VALUES (?, ?, ?)
       ON CONFLICT(source_id, claim_type) DO UPDATE SET authoritative = excluded.authoritative`,
    )
    .run(sourceId, claimType, authoritative ? 1 : 0);
  if (result.changes === 0) throw new Error(`no source ${sourceId}`);
}

/** Forget every authority row for a source; the caller re-declares the current set. */
export function clearAuthority(store: StateStore, sourceId: string): void {
  store.db.prepare('DELETE FROM source_authority WHERE source_id = ?').run(sourceId);
}

export interface SourceAuthority {
  readonly authoritativeFor: readonly string[];
  readonly notAuthoritativeFor: readonly string[];
}

export function authorityOf(store: StateStore, sourceId: string): SourceAuthority {
  const rows = store.db
    .prepare('SELECT claim_type, authoritative FROM source_authority WHERE source_id = ? ORDER BY claim_type')
    .all(sourceId) as unknown as Array<{ claim_type: string; authoritative: number }>;
  return {
    authoritativeFor: rows.filter((r) => r.authoritative === 1).map((r) => r.claim_type),
    notAuthoritativeFor: rows.filter((r) => r.authoritative === 0).map((r) => r.claim_type),
  };
}

/**
 * Is this source authoritative for a claim type? Only an explicit row says
 * yes; silence is "not declared", never a default yes.
 */
export function isAuthoritativeFor(
  store: StateStore,
  sourceId: string,
  claimType: string,
): 'yes' | 'no' | 'undeclared' {
  const row = store.db
    .prepare('SELECT authoritative FROM source_authority WHERE source_id = ? AND claim_type = ?')
    .get(sourceId, claimType) as { authoritative: number } | undefined;
  if (!row) return 'undeclared';
  return row.authoritative === 1 ? 'yes' : 'no';
}

export interface SourceSnapshot {
  readonly id: string;
  readonly sourceId: string;
  readonly digest: string;
  readonly summary: string | null;
  readonly evidenceRef: string | null;
  readonly takenAt: string;
}

interface SnapshotRow {
  readonly id: string;
  readonly source_id: string;
  readonly digest: string;
  readonly summary: string | null;
  readonly evidence_ref: string | null;
  readonly taken_at: string;
}

function toSnapshot(row: SnapshotRow): SourceSnapshot {
  return {
    id: row.id,
    sourceId: row.source_id,
    digest: row.digest,
    summary: row.summary,
    evidenceRef: row.evidence_ref,
    takenAt: row.taken_at,
  };
}

/**
 * Record a snapshot. A digest already seen for this source is not stored
 * again; the existing snapshot becomes the latest and `changed` is false.
 */
export function recordSnapshot(
  store: StateStore,
  input: {
    readonly id: string;
    readonly sourceId: string;
    readonly digest: string;
    readonly summary?: string;
    readonly evidenceRef?: string;
    readonly at: string;
  },
): { readonly snapshot: SourceSnapshot; readonly changed: boolean } {
  requireNonEmpty(input.digest, 'snapshot.digest');
  requireInstant(input.at, 'snapshot.at');
  return store.transaction(() => {
    const existing = store.db
      .prepare('SELECT * FROM source_snapshots WHERE source_id = ? AND digest = ?')
      .get(input.sourceId, input.digest) as SnapshotRow | undefined;
    let snapshot: SourceSnapshot;
    let changed: boolean;
    if (existing) {
      snapshot = toSnapshot(existing);
      changed = false;
    } else {
      const row = store.db
        .prepare(
          `INSERT INTO source_snapshots (id, source_id, digest, summary, evidence_ref, taken_at)
           VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
        )
        .get(
          input.id,
          input.sourceId,
          input.digest,
          input.summary ?? null,
          input.evidenceRef ?? null,
          input.at,
        ) as unknown as SnapshotRow;
      snapshot = toSnapshot(row);
      changed = true;
    }
    const updated = store.db
      .prepare(
        `UPDATE sources SET last_snapshot_id = ?, reachability = 'reachable', updated_at = ? WHERE id = ?`,
      )
      .run(snapshot.id, input.at, input.sourceId);
    if (updated.changes === 0) throw new Error(`no source ${input.sourceId}`);
    return { snapshot, changed };
  });
}

export function latestSnapshot(store: StateStore, sourceId: string): SourceSnapshot | null {
  const source = getSource(store, sourceId);
  if (!source?.lastSnapshotId) return null;
  const row = store.db
    .prepare('SELECT * FROM source_snapshots WHERE id = ?')
    .get(source.lastSnapshotId) as SnapshotRow | undefined;
  return row ? toSnapshot(row) : null;
}

export type Freshness = 'fresh' | 'stale' | 'never_read' | 'no_expectation';

/** How current a source's last read is against its declared expectation. */
export function freshnessOf(store: StateStore, sourceId: string, at: string): Freshness {
  const source = getSource(store, sourceId);
  if (!source) throw new Error(`no source ${sourceId}`);
  const snapshot = latestSnapshot(store, sourceId);
  if (!snapshot) return 'never_read';
  if (source.freshnessHours === null) return 'no_expectation';
  const ageMs = Date.parse(at) - Date.parse(snapshot.takenAt);
  return ageMs <= source.freshnessHours * 3_600_000 ? 'fresh' : 'stale';
}
