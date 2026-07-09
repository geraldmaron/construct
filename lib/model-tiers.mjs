/**
 * lib/model-tiers.mjs — the canonical model-tier vocabulary.
 *
 * `reasoning`, `standard`, and `fast` are the three work tiers every
 * model-resolution surface keys off: the router's family tables, the registry
 * validator's accept-list, cost selection, policy presets, the CLI, and the
 * MCP tool schemas. They lived as a `['reasoning', 'standard', 'fast']` literal
 * re-typed in ~30 places, so adding or renaming a tier meant the accept-lists
 * could silently diverge from what the router actually resolves (construct-v1wk).
 *
 * Single source of truth for that vocabulary — deliberately zero-dependency so
 * the lowest-level consumers (the registry validator, setup) can import it
 * without pulling the router's provider probes or model-policy's
 * pricing/registry imports. A JSON-schema `enum` or any caller that needs a
 * fresh mutable array spreads it: `[...MODEL_TIERS]`.
 *
 * The intentionally self-contained `lib/embedded-contract/` bundle keeps its
 * own copy on purpose — it must not import `lib/` internals.
 */

export const MODEL_TIERS = Object.freeze(['reasoning', 'standard', 'fast']);

export const MODEL_TIER_SET = Object.freeze(new Set(MODEL_TIERS));

export function isModelTier(value) {
  return MODEL_TIER_SET.has(value);
}
