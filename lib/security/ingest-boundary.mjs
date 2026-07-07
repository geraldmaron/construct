/**
 * lib/security/ingest-boundary.mjs — Source-kind → trust-level mapping at the
 * ingest boundary.
 *
 * Maps named source kinds (provider type, pipeline stage, ingestion method)
 * to canonical trust levels and stamps them onto records using the primitives
 * in lib/security/trust.mjs.
 *
 * The module is additive — existing ingest, embed, or storage code is not modified.
 * Callers that want labeling import `stampIngestBoundary` and
 * apply it at the point where external content enters Construct's data layer.
 *
 * References: CX-AUDIT-LLMSEC-001, construct-9oi4.14.1
 */

import { TRUST_LEVELS, stampTrust } from './trust.mjs';

// ---------------------------------------------------------------------------
// Source-kind registry
// ---------------------------------------------------------------------------

/**
 * Mapping from well-known source kind strings to trust levels.
 * All entries are lowercase; callers should normalise before lookup.
 */
const SOURCE_KIND_MAP = {
  // Built-in / internal
  'builtin-prompt':   TRUST_LEVELS.TRUSTED_INTERNAL,
  'validated-pack':   TRUST_LEVELS.TRUSTED_INTERNAL,

  // Team-authored local content
  'team-authored':    TRUST_LEVELS.TEAM_AUTHORED,
  'local-committed':  TRUST_LEVELS.TEAM_AUTHORED,

  // Authenticated external providers
  'github-issue':     TRUST_LEVELS.EXTERNAL_AUTHENTICATED,
  'github-pr':        TRUST_LEVELS.EXTERNAL_AUTHENTICATED,
  'github-comment':   TRUST_LEVELS.EXTERNAL_AUTHENTICATED,
  'jira-ticket':      TRUST_LEVELS.EXTERNAL_AUTHENTICATED,
  'jira-comment':     TRUST_LEVELS.EXTERNAL_AUTHENTICATED,
  'confluence-page':  TRUST_LEVELS.EXTERNAL_AUTHENTICATED,
  'linear-issue':     TRUST_LEVELS.EXTERNAL_AUTHENTICATED,

  // Unauthenticated / parsed / scraped content
  'docling-parsed':   TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED,
  'web-fetched':      TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED,
  'web-search-result': TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED,
  'pdf-extracted':    TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED,
  'unknown':          TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED,
};

/**
 * Resolve the trust level for a given source kind string.
 * Unrecognised kinds default to EXTERNAL_UNAUTHENTICATED (fail-safe).
 *
 * @param {string} sourceKind
 * @returns {string} TRUST_LEVELS value
 */
export function resolveTrustLevel(sourceKind) {
  const key = (sourceKind ?? 'unknown').toLowerCase();
  return SOURCE_KIND_MAP[key] ?? TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED;
}

/**
 * Stamp a trust label onto a record at the ingest boundary.
 *
 * Maps `sourceKind` to the appropriate trust level and delegates to
 * `stampTrust`. The resulting record has a `_trust` field that downstream
 * consumers (recall wrappers, context assemblers) can inspect.
 *
 * @param {Record<string, unknown>} record     The record being ingested.
 * @param {string}                  sourceKind Well-known source kind string.
 * @param {{ sourceRef?: string }}  [options]  Optional extra metadata.
 * @returns {Record<string, unknown>} Stamped record (source record not mutated).
 */
export function stampIngestBoundary(record, sourceKind, options = {}) {
  const level = resolveTrustLevel(sourceKind);
  const source = options.sourceRef ?? sourceKind ?? 'unknown';
  return stampTrust(record, level, source);
}
