/**
 * lib/tracker-projection/projection.mjs — build one Projection record from a bd
 * issue (construct-b0nny.27 / E8), realizing target-model.md concept 16's
 * Projection schema.
 *
 * Pure: no I/O, no bd access, no workspace resolution. `buildProjection` takes a
 * raw bd issue object (as returned by `bd list --all --json`) and produces a
 * Projection whose `raw_record` is a verbatim deep clone of the entire original
 * issue — every field survives, including the ones the new model does not use
 * (dependency_count, comment_count, created_by, …) — so import is provably
 * zero-loss (program rule 2, directive §14.16). `fields` is the mutable
 * last-synced snapshot reconciliation diffs against; `raw_record` is the
 * immutable source-of-import audit copy and is never mutated by reconciliation.
 */

import { AUTHORITY, IDENTITY_FIELDS, authorityFor } from './field-authority.mjs';

export const PROJECTION_STATES = Object.freeze(['projected', 'reconciling', 'in_sync', 'drifted']);
export const TRACKER = 'beads';

function deepClone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

/**
 * Key-order-independent JSON serialization, so two field values that differ
 * only in object key ordering compare equal — the equality basis for
 * raw-record verification and reconciliation drift comparison.
 *
 * @param {*} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function valuesEqual(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * The projection id for a bead: `beads:<external_id>`. Stable across re-imports
 * so a re-import updates the same projection rather than minting a duplicate.
 *
 * @param {string} externalId
 * @returns {string}
 */
export function projectionId(externalId) {
  return `${TRACKER}:${externalId}`;
}

/**
 * Build a Projection record from a bd issue. Records the resolved authority for
 * every non-identity field present on the issue, snapshots those field values
 * into `fields`, and preserves the whole issue verbatim in `raw_record`.
 *
 * @param {object} issue - a raw bd issue (must carry an `id`)
 * @param {{ workspace?: string|null, workId?: string|null, importedAt?: string }} [opts]
 * @returns {object} Projection record
 */
export function buildProjection(issue, { workspace = null, workId = null, importedAt = null } = {}) {
  if (!issue || typeof issue !== 'object' || Array.isArray(issue) || typeof issue.id !== 'string') {
    throw new Error('buildProjection: issue must be an object with a string id');
  }

  const fieldAuthority = {};
  const fields = {};
  for (const field of Object.keys(issue)) {
    if (IDENTITY_FIELDS.includes(field)) continue;
    fieldAuthority[field] = authorityFor(field);
    fields[field] = deepClone(issue[field]);
  }

  const ts = importedAt || new Date().toISOString();
  return {
    id: projectionId(issue.id),
    workspace,
    work: workId,
    tracker: TRACKER,
    external_id: issue.id,
    field_authority: fieldAuthority,
    state: 'projected',
    fields,
    raw_record: deepClone(issue),
    importedAt: ts,
    reconciledAt: null,
  };
}

/**
 * Domain-owned and tracker-owned field names recorded on a projection.
 *
 * @param {object} projection
 * @returns {{ domain: string[], tracker: string[] }}
 */
export function projectionFieldsByAuthority(projection) {
  const domain = [];
  const tracker = [];
  for (const [field, authority] of Object.entries(projection?.field_authority ?? {})) {
    if (authority === AUTHORITY.DOMAIN) domain.push(field);
    else tracker.push(field);
  }
  return { domain, tracker };
}
