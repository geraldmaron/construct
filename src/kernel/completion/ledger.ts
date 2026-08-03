/**
 * kernel/completion/ledger.ts — evidence objects and the no-forgery completion
 * ledger. Ported from the predecessor's
 * deliverable-completion module (v2 spelled a deliverable differently; the
 * evidence field is `deliverable` here, and the capture script that locks this
 * port translates the two). Exact v2 source paths live in
 * scripts/capture-legacy-kernel-golden.mjs.
 *
 * A completion state advances only when backed by a re-verifiable evidence
 * object; a step that could not run records a typed degradation that documents
 * the miss without advancing the ladder. The no-forgery invariant lives in
 * code: no path records a rung without constructing valid evidence for it.
 * Timestamps are injected (null by default) so a run report stays
 * deterministic — callers assert deepEqual across identical runs.
 */

import { COMPLETION_STATES, completionRank, isCompletionState } from './states.ts';
import type { CompletionState } from './states.ts';

export const DEGRADATION_REASONS = [
  'unavailable-renderer',
  'missing-dependency',
  'unsupported-format',
  'headless-limitation',
  'skipped-by-policy',
] as const;

export type DegradationReason = (typeof DEGRADATION_REASONS)[number];

export interface Evidence {
  readonly state: CompletionState;
  readonly actor: string;
  readonly deliverable: string | null;
  readonly proof: string | null;
  readonly digest: string | null;
  readonly degradation: DegradationReason | null;
  readonly reversible: boolean;
  readonly timestamp: string | null;
}

export interface EvidenceInput {
  readonly actor: string;
  readonly deliverable?: string | null;
  readonly proof?: string | null;
  readonly digest?: string | null;
  readonly degradation?: DegradationReason | null;
  readonly reversible?: boolean;
  readonly timestamp?: string | null;
}

export function makeEvidence(state: string, input: EvidenceInput): Evidence {
  const {
    actor,
    deliverable = null,
    proof = null,
    digest = null,
    degradation = null,
    reversible = true,
    timestamp = null,
  } = input ?? ({} as EvidenceInput);

  if (!isCompletionState(state)) {
    throw new Error(
      `unknown completion state: ${state} (expected one of ${COMPLETION_STATES.join(', ')})`,
    );
  }
  if (degradation !== null && !(DEGRADATION_REASONS as readonly string[]).includes(degradation)) {
    throw new Error(`unknown degradation reason: ${degradation}`);
  }
  if (typeof actor !== 'string' || actor.length === 0) {
    throw new Error('evidence requires a non-empty actor');
  }
  return Object.freeze({
    state,
    actor,
    deliverable,
    proof,
    digest,
    degradation,
    reversible,
    timestamp,
  });
}

/**
 * recordCompletion is the only way a state enters the ledger; passing anything
 * but a valid evidence object throws, so a rung cannot be claimed without proof
 * for it.
 */
export function recordCompletion(
  ledger: readonly Evidence[],
  evidence: Evidence,
): readonly Evidence[] {
  if (!evidence || typeof evidence !== 'object' || !isCompletionState(evidence.state)) {
    throw new Error('completion requires a valid evidence object');
  }
  return [...ledger, evidence];
}

/**
 * The achieved state is the highest-ranked rung with non-degraded evidence; a
 * degraded entry is kept for the record but never lifts the ladder.
 */
export function highestState(ledger: readonly Evidence[] = []): CompletionState | null {
  let best: CompletionState | null = null;
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
