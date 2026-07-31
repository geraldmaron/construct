/**
 * lib/security/trust.mjs — Trust taxonomy and stamping primitives.
 *
 * Provides a machine-checkable trust hierarchy for all content that flows
 * through Construct: ingested documents, recalled observations, provider
 * responses, and built-in prompts. Callers stamp records at ingestion time
 * and downstream consumers check the stamp before assembling model context.
 *
 * Integration into callers (ingest/embed/storage paths) is handled by
 * follow-on beads (N2, N4). This module is additive — it exports utilities
 * only; no existing code is modified.
 *
 * References: OWASP LLM01 [S12][S13]
 */

// ---------------------------------------------------------------------------
// Trust level taxonomy (ordered lowest → highest trust)
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
export const TRUST_LEVELS = {
  /** Scraped or parsed content with no authorship verification (web pages,
   *  docling-extracted text, unknown origin). Highest risk of injection. */
  EXTERNAL_UNAUTHENTICATED: 'external-unauthenticated',

  /** Content from an authenticated external actor: a known GitHub user's
   *  issue-tracker comment, a named Jira reporter, a Confluence page with
   *  attributed authorship. Lower risk but still untrusted. */
  EXTERNAL_AUTHENTICATED: 'external-authenticated',

  /** Authored by a member of the Construct team or project (e.g. a local
   *  markdown file committed by the team). Trusted but not built-in. */
  TEAM_AUTHORED: 'team-authored',

  /** Built-in prompts, validated skill packs, and internal system content.
   *  Full trust — assembled directly into the instruction channel. */
  TRUSTED_INTERNAL: 'trusted-internal',
};

// Ordered list for comparison (index = rank, higher index = higher trust).
const LEVEL_ORDER = [
  TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED,
  TRUST_LEVELS.EXTERNAL_AUTHENTICATED,
  TRUST_LEVELS.TEAM_AUTHORED,
  TRUST_LEVELS.TRUSTED_INTERNAL,
];

// ---------------------------------------------------------------------------
// Stamping
// ---------------------------------------------------------------------------

/**
 * Stamp a trust label onto an observation or record object.
 *
 * @param {Record<string, unknown>} record  Source object (not mutated).
 * @param {string}                  level   One of TRUST_LEVELS values.
 * @param {string}                  source  Human-readable source descriptor.
 * @returns {Record<string, unknown>} New object with `_trust` metadata added.
 */
export function stampTrust(record, level, source) {
  if (!Object.values(TRUST_LEVELS).includes(level)) {
    throw new TypeError(
      `stampTrust: unknown trust level "${level}". ` +
      `Valid values: ${Object.values(TRUST_LEVELS).join(', ')}`,
    );
  }
  return {
    ...record,
    _trust: {
      level,
      source: String(source ?? 'unknown'),
      stampedAt: Date.now(),
    },
  };
}

// ---------------------------------------------------------------------------
// Level comparison
// ---------------------------------------------------------------------------

/**
 * Return true if `level` meets or exceeds `required` in the trust hierarchy.
 *
 * @param {string} level    The trust level of the content being checked.
 * @param {string} required The minimum acceptable trust level.
 * @returns {boolean}
 */
export function meetsMinTrustLevel(level, required) {
  const levelIdx = LEVEL_ORDER.indexOf(level);
  const requiredIdx = LEVEL_ORDER.indexOf(required);
  if (levelIdx === -1 || requiredIdx === -1) return false;
  return levelIdx >= requiredIdx;
}

// ---------------------------------------------------------------------------
// Context assembly helpers
// ---------------------------------------------------------------------------

/**
 * Wrap external content with explicit untrusted delimiters so the model
 * context assembler can visually and programmatically distinguish data from
 * instructions.
 *
 * @param {string}                              content   Raw text content.
 * @param {{ level: string, source: string }}   trustMeta Trust metadata.
 * @returns {string} Delimited content string.
 */
export function wrapUntrusted(content, trustMeta) {
  const level = trustMeta?.level ?? TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED;
  const source = trustMeta?.source ?? 'unknown';
  return `[UNTRUSTED:${level}:${source}]\n${content}\n[/UNTRUSTED]`;
}

// ---------------------------------------------------------------------------
// Recall re-grading
// ---------------------------------------------------------------------------

/**
 * Re-grade a recalled record — returns the `_trust` meta object if present,
 * or null if the record was stored without a trust stamp.
 *
 * Callers should treat a null return as EXTERNAL_UNAUTHENTICATED per policy.
 *
 * @param {Record<string, unknown>} record A recalled observation or document.
 * @returns {{ level: string, source: string, stampedAt: number } | null}
 */
export function recallTrustGrade(record) {
  if (record && typeof record._trust === 'object' && record._trust !== null) {
    return record._trust;
  }
  return null;
}
