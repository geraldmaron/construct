/**
 * lib/tracker-projection/field-authority.mjs — the field-authority map for the
 * Beads projection (construct-b0nny.27 / E8), realizing target-model.md
 * concept 16's `field_authority: {field: enum(domain, tracker)}`.
 *
 * A Beads issue is a Projection of a graph-informed Work model, not the domain
 * model itself. Each bd field is owned by exactly one side: `tracker` (bd owns
 * it — its live operational state and audit metadata) or `domain` (projected
 * from the E1 graph / E3 Work-spec — dependency edges and the Work spec's
 * what/why). The reconciliation rule (concept 16 Enforcement, directive §9): a
 * domain-owned field is never overwritten by the tracker, and a tracker-owned
 * field is never overwritten by the domain.
 *
 * The full reviewed table with per-field rationale is docs/notes/research/
 * workspace-control-plane/synthesis/beads-projection-design.md §3.
 */

export const AUTHORITY = Object.freeze({ DOMAIN: 'domain', TRACKER: 'tracker' });

// bd owns its live operational fields and its own audit timestamps; the domain
// (E1 graph + E3 Work-spec) owns the derived dependency/parent edges and the
// Work spec's what/why (title/description/type). Identity fields belong to
// neither side and are never rewritten. Any bd field absent from this map is
// treated as tracker-owned by default (authorityFor) — bd-produced metadata
// bd is free to change — while still preserved verbatim in raw_record.

export const FIELD_AUTHORITY = Object.freeze({
  status: AUTHORITY.TRACKER,
  assignee: AUTHORITY.TRACKER,
  owner: AUTHORITY.TRACKER,
  priority: AUTHORITY.TRACKER,
  labels: AUTHORITY.TRACKER,
  created_at: AUTHORITY.TRACKER,
  created_by: AUTHORITY.TRACKER,
  updated_at: AUTHORITY.TRACKER,
  started_at: AUTHORITY.TRACKER,
  closed_at: AUTHORITY.TRACKER,
  close_reason: AUTHORITY.TRACKER,
  dependency_count: AUTHORITY.TRACKER,
  dependent_count: AUTHORITY.TRACKER,
  comment_count: AUTHORITY.TRACKER,
  dependencies: AUTHORITY.DOMAIN,
  parent: AUTHORITY.DOMAIN,
  title: AUTHORITY.DOMAIN,
  description: AUTHORITY.DOMAIN,
  issue_type: AUTHORITY.DOMAIN,
});

// Identity fields link the mirror to its domain Work; they are excluded from
// authority comparison because neither side may rewrite them.

export const IDENTITY_FIELDS = Object.freeze(['id']);

/**
 * Return the authority ('domain' | 'tracker') for a bd field. Fields not in the
 * explicit map default to tracker-owned (bd-produced metadata bd may change).
 *
 * @param {string} field
 * @returns {'domain'|'tracker'}
 */
export function authorityFor(field) {
  return FIELD_AUTHORITY[field] ?? AUTHORITY.TRACKER;
}

export function isDomainOwned(field) {
  return authorityFor(field) === AUTHORITY.DOMAIN;
}

export function isTrackerOwned(field) {
  return authorityFor(field) === AUTHORITY.TRACKER;
}

/**
 * The domain-owned and tracker-owned field names present on a given issue,
 * split by authority. Identity fields are omitted from both.
 *
 * @param {object} issue
 * @returns {{ domain: string[], tracker: string[] }}
 */
export function splitFieldsByAuthority(issue) {
  const domain = [];
  const tracker = [];
  for (const field of Object.keys(issue || {})) {
    if (IDENTITY_FIELDS.includes(field)) continue;
    if (isDomainOwned(field)) domain.push(field);
    else tracker.push(field);
  }
  return { domain, tracker };
}
