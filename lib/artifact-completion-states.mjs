/**
 * lib/artifact-completion-states.mjs — the single ordered completion-state vocabulary.
 *
 * One canonical list, shared by the manifest schema ($defs.completionState), the manifest
 * validator (qualityContract.requiredStates), and — as they land — the workflow report and CLI
 * output. The order is the completion ladder: an artifact carries the highest rung for which it
 * holds re-verifiable evidence. Keep this array byte-identical to the schema enum; the parity
 * test (tests/asset-quality/completion-states.test.mjs) fails if they drift.
 */

export const COMPLETION_STATES = Object.freeze([
  'planned',
  'authored',
  'structurally-valid',
  'source-linted',
  'exported',
  'file-valid',
  'renderable',
  'screenshot-captured',
  'visually-reviewed',
  'accessibility-reviewed',
  'approved',
  'completed',
]);

export function isCompletionState(state) {
  return COMPLETION_STATES.includes(state);
}

// Rank is the ladder position; -1 for an unknown state. Lets callers compare progression
// (a later rung requires every earlier rung's evidence) without hardcoding the order.

export function completionRank(state) {
  return COMPLETION_STATES.indexOf(state);
}
