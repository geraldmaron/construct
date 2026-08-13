/**
 * kernel/context/review.ts — the drift review: what disagrees inside a
 * workspace's declared ground, asked without a note to occasion it.
 *
 * The note loop already produced drift observations, but only ever as a side
 * effect of somebody dropping a call note. A person acting as program manager
 * over a documents repository has the opposite need — read what is there and
 * tell me what contradicts — and there was no way to ask for it.
 *
 * This module owns only the shape and the validation. The model call lives in
 * the host layer, the citation judgment stays in observations.ts, and the
 * survey that says which documents exist stays in the IO half. What is
 * deliberately absent is memory deltas and outward proposals: both justify
 * themselves by citing a line of a note, and a review has no note, so a review
 * that emitted them would be emitting conclusions with nothing to cite.
 */

import { toObservations } from './produce.ts';
import type { ProducerSource } from './produce.ts';
import type { Observation } from './observations.ts';

/** The role recorded on an observation a note-free review made. */
export const REVIEWER_ROLE = 'drift-reviewer';

/**
 * A model asked what disagrees across a set of surveyed documents. Throws on
 * failure the way every other host seam does: a review that could not be run
 * is a stated stop, never an empty result that reads as "nothing disagrees".
 */
export type DriftReviewer = (input: {
  readonly sources: readonly ProducerSource[];
}) => Promise<unknown>;

export interface ReviewedDrift {
  readonly observations: readonly Observation[];
  /** Items the reading pass could not make sense of, each with its reason. */
  readonly discarded: readonly string[];
}

/**
 * Validate a parsed reviewer reply. A shapeless reply is an empty review
 * rather than an error: the model answering "nothing disagrees" and the model
 * answering nothing at all are both handled downstream by a screen that
 * reports what it kept, and neither is a crash.
 */
export function toReviewedDrift(parsed: unknown): ReviewedDrift {
  const record = parsed as { observations?: unknown } | null;
  const discarded: string[] = [];
  return { observations: toObservations(record?.observations, REVIEWER_ROLE, discarded), discarded };
}
