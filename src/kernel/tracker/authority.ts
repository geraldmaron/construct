/**
 * kernel/tracker/authority.ts — which side owns which field of a tracker
 * mirror. Ported from the predecessor's field-authority module; the exact v2
 * source path is cited in scripts/capture-legacy-tracker-golden.mjs.
 *
 * A tracker issue is a PROJECTION of Construct's own work model, not the model
 * itself. Every field is owned by exactly one side: `tracker` (the issue
 * tracker owns it — live operational state and its own audit metadata) or
 * `domain` (projected from Construct — dependency edges and the work's
 * what/why). The reconciliation rule falls straight out of that: a
 * domain-owned field is never overwritten by the tracker, and a tracker-owned
 * field is never overwritten by the domain.
 *
 * The default matters. A field absent from the map is treated as TRACKER-owned,
 * not domain-owned — an unknown field is far more likely to be tracker metadata
 * Construct has no opinion about, and defaulting the other way would mean
 * Construct silently claiming authority over data it does not understand and
 * overwriting it. Unknown fields are still preserved verbatim in the raw record.
 */

export const AUTHORITY = { DOMAIN: 'domain', TRACKER: 'tracker' } as const;

export type Authority = (typeof AUTHORITY)[keyof typeof AUTHORITY];

export const FIELD_AUTHORITY: Readonly<Record<string, Authority>> = Object.freeze({
  // The tracker's own live state and audit trail.
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
  // Derived from Construct's graph and work spec.
  dependencies: AUTHORITY.DOMAIN,
  parent: AUTHORITY.DOMAIN,
  title: AUTHORITY.DOMAIN,
  description: AUTHORITY.DOMAIN,
  issue_type: AUTHORITY.DOMAIN,
});

/**
 * Identity fields link the mirror to its domain work. They belong to neither
 * side and are excluded from authority comparison — neither may rewrite them.
 */
export const IDENTITY_FIELDS: readonly string[] = Object.freeze(['id']);

/** Authority for a field; anything unmapped is tracker-owned. See the module note. */
export function authorityFor(field: string): Authority {
  return FIELD_AUTHORITY[field] ?? AUTHORITY.TRACKER;
}

export function isDomainOwned(field: string): boolean {
  return authorityFor(field) === AUTHORITY.DOMAIN;
}

export function isTrackerOwned(field: string): boolean {
  return authorityFor(field) === AUTHORITY.TRACKER;
}

export interface FieldsByAuthority {
  readonly domain: readonly string[];
  readonly tracker: readonly string[];
}

/**
 * Split the fields present on an issue by authority. Identity fields appear in
 * neither list.
 */
export function splitFieldsByAuthority(issue: unknown): FieldsByAuthority {
  const domain: string[] = [];
  const tracker: string[] = [];
  for (const field of Object.keys((issue as object) ?? {})) {
    if (IDENTITY_FIELDS.includes(field)) continue;
    if (isDomainOwned(field)) domain.push(field);
    else tracker.push(field);
  }
  return { domain, tracker };
}
