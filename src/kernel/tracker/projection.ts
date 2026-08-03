/**
 * kernel/tracker/projection.ts — build one projection record from a tracker
 * issue. Ported from the predecessor's projection module; the exact v2 source
 * path is cited in scripts/capture-legacy-tracker-golden.mjs.
 *
 * Pure: no IO, no tracker access, no workspace resolution. It takes a raw issue
 * object and produces a projection whose `raw_record` is a verbatim deep clone
 * of the whole original — every field survives, including the ones this model
 * does not use — so an import is provably zero-loss. `fields` is the mutable
 * last-synced snapshot that reconciliation diffs against; `raw_record` is the
 * immutable audit copy and is never touched by reconciliation.
 *
 * One change from v2, and it is the reason this module could be harvested at
 * all: v2 defaulted `importedAt` to `new Date().toISOString()`, so building a
 * projection read the clock and two identical imports were never equal. Here
 * the timestamp is injected and defaults to null, matching the discipline
 * kernel/completion/ledger.ts already follows — the kernel does not read the
 * clock, the host supplies the time. A caller that wants v2's behavior passes
 * its own timestamp.
 *
 * Deliberately NOT ported: the storage layer. v2 persisted these through a Dolt
 * lock, which is a rewrite rather than a port, and the substrate it should be
 * rewritten onto is the one Phase 2's spine needs for the work log and decision
 * inbox. Fixing a storage shape before that consumer exists would be guessing.
 * See construct-cpz.
 */

import { AUTHORITY, IDENTITY_FIELDS, authorityFor } from './authority.ts';
import type { Authority } from './authority.ts';

export const PROJECTION_STATES = ['projected', 'reconciling', 'in_sync', 'drifted'] as const;

export type ProjectionState = (typeof PROJECTION_STATES)[number];

export interface Projection {
  readonly id: string;
  readonly workspace: string | null;
  readonly work: string | null;
  readonly tracker: string;
  readonly external_id: string;
  readonly field_authority: Readonly<Record<string, Authority>>;
  readonly state: ProjectionState;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly raw_record: unknown;
  readonly importedAt: string | null;
  readonly reconciledAt: string | null;
}

export interface BuildProjectionOptions {
  readonly tracker?: string;
  readonly workspace?: string | null;
  readonly workId?: string | null;
  /** Injected; the kernel never reads the clock. See the module note. */
  readonly importedAt?: string | null;
}

function deepClone<T>(value: T): T {
  return value === undefined ? (undefined as T) : structuredClone(value);
}

/**
 * Key-order-independent JSON, so two values differing only in key order compare
 * equal. This is the equality basis for raw-record verification and for
 * reconciliation drift detection — without it, a tracker that reserializes an
 * object with different key order would read as drift on every sync.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * The projection id for an issue: `<tracker>:<external id>`. Stable across
 * re-imports, so a re-import updates the same projection instead of minting a
 * duplicate.
 */
export function projectionId(externalId: string, tracker = 'beads'): string {
  return `${tracker}:${externalId}`;
}

/**
 * Build a projection from a raw tracker issue: record the resolved authority for
 * every non-identity field, snapshot those values into `fields`, and preserve
 * the whole issue verbatim in `raw_record`.
 */
export function buildProjection(issue: unknown, options: BuildProjectionOptions = {}): Projection {
  const record = issue as Record<string, unknown> | null;
  if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.id !== 'string') {
    throw new Error('buildProjection: issue must be an object with a string id');
  }

  const tracker = options.tracker ?? 'beads';
  const fieldAuthority: Record<string, Authority> = {};
  const fields: Record<string, unknown> = {};
  for (const field of Object.keys(record)) {
    if (IDENTITY_FIELDS.includes(field)) continue;
    fieldAuthority[field] = authorityFor(field);
    fields[field] = deepClone(record[field]);
  }

  return {
    id: projectionId(record.id, tracker),
    workspace: options.workspace ?? null,
    work: options.workId ?? null,
    tracker,
    external_id: record.id,
    field_authority: fieldAuthority,
    state: 'projected',
    fields,
    raw_record: deepClone(record),
    importedAt: options.importedAt ?? null,
    reconciledAt: null,
  };
}

export interface FieldsByAuthority {
  readonly domain: readonly string[];
  readonly tracker: readonly string[];
}

/** The domain- and tracker-owned field names recorded on a projection. */
export function projectionFieldsByAuthority(projection: unknown): FieldsByAuthority {
  const domain: string[] = [];
  const tracker: string[] = [];
  const map = (projection as { field_authority?: Record<string, Authority> } | null)?.field_authority ?? {};
  for (const [field, authority] of Object.entries(map)) {
    if (authority === AUTHORITY.DOMAIN) domain.push(field);
    else tracker.push(field);
  }
  return { domain, tracker };
}
