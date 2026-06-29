/**
 * lib/artifact-completion.mjs — Evidence objects and the no-forgery completion ledger.
 *
 * A completion state advances only when backed by a re-verifiable evidence object; a step that
 * could not run records a typed degradation that documents the miss without advancing the ladder.
 * The no-forgery invariant lives in code: no path records a rung without constructing valid
 * evidence for it. Timestamps are injected (null by default) so a run report stays
 * deterministic — the workflow asserts deepEqual across identical runs.
 */
import { COMPLETION_STATES, isCompletionState, completionRank } from './artifact-completion-states.mjs';

export const DEGRADATION_REASONS = Object.freeze([
  'unavailable-renderer',
  'missing-dependency',
  'unsupported-format',
  'headless-limitation',
  'skipped-by-policy',
]);

export function makeEvidence(state, {
  actor,
  artifact = null,
  proof = null,
  digest = null,
  degradation = null,
  reversible = true,
  timestamp = null,
} = {}) {
  if (!isCompletionState(state)) {
    throw new Error(`unknown completion state: ${state} (expected one of ${COMPLETION_STATES.join(', ')})`);
  }
  if (degradation !== null && !DEGRADATION_REASONS.includes(degradation)) {
    throw new Error(`unknown degradation reason: ${degradation}`);
  }
  if (typeof actor !== 'string' || actor.length === 0) {
    throw new Error('evidence requires a non-empty actor');
  }
  return Object.freeze({ state, actor, artifact, proof, digest, degradation, reversible, timestamp });
}

// recordCompletion is the only way a state enters the ledger; passing anything but a valid
// evidence object throws, so a rung cannot be claimed without proof for it.

export function recordCompletion(ledger, evidence) {
  if (!evidence || typeof evidence !== 'object' || !isCompletionState(evidence.state)) {
    throw new Error('completion requires a valid evidence object');
  }
  return [...ledger, evidence];
}

// The achieved state is the highest-ranked rung with non-degraded evidence; a degraded entry is
// kept for the record but never lifts the ladder.

export function highestState(ledger = []) {
  let best = null;
  let bestRank = -1;
  for (const evidence of ledger) {
    if (evidence.degradation) continue;
    const rank = completionRank(evidence.state);
    if (rank > bestRank) {
      bestRank = rank;
      best = evidence.state;
    }
  }
  return best;
}
