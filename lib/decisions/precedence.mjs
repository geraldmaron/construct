/**
 * lib/decisions/precedence.mjs — explicit precedence for conflicting guidance.
 *
 * When two rules give contradictory direction, the conflict must resolve the same
 * way every time, not by whichever the model read last. PRECEDENCE_TIERS is the
 * canonical order (index 0 wins); a rule declares its tier in frontmatter
 * (`precedence_tier`), and resolvePrecedence answers which of two tiers governs.
 *
 * Scope is deliberate: this provides deterministic TIER-based precedence, not
 * natural-language contradiction detection. It makes the resolution order
 * explicit and validates that declared tiers are real; judging whether two rules
 * actually contradict remains human work.
 */

export const PRECEDENCE_TIERS = ['safety', 'security', 'correctness', 'durability', 'performance', 'style'];

export function tierRank(tier) {
  const i = PRECEDENCE_TIERS.indexOf(tier);
  return i === -1 ? Number.POSITIVE_INFINITY : i;
}

/**
 * Resolve which tier governs. Returns -1 if a wins, 1 if b wins, 0 if equal rank.
 * A lower index is higher priority (safety beats style).
 */
export function resolvePrecedence(a, b) {
  const ra = tierRank(a);
  const rb = tierRank(b);
  if (ra < rb) return -1;
  if (ra > rb) return 1;
  return 0;
}

/**
 * Validate declared precedence tiers over a decisions array (bead wvbf.8): any
 * rule that declares a `precedence_tier` must use one from PRECEDENCE_TIERS.
 */
export function validatePrecedenceTiersOn(decisions) {
  const violations = [];
  for (const d of decisions) {
    if (d.precedenceTier && !PRECEDENCE_TIERS.includes(d.precedenceTier)) {
      violations.push(`${d.id}: unknown precedence_tier "${d.precedenceTier}" (expected one of ${PRECEDENCE_TIERS.join(', ')})`);
    }
  }
  return { ok: violations.length === 0, violations };
}
