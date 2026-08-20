/**
 * kernel/challenge/familyroute.ts — which family answers an adversarial
 * challenge or judge pass, and what that choice costs.
 *
 * Serves commitment 9's 2026-08-05 amendment (routing consumes measured
 * facts, never a model's self-reported confidence) applied to a different
 * question: not which domain a naming belongs to, but whose read on a
 * deliverable counts as a second opinion. A challenge pass run through the
 * same family that produced the deliverable is not independent verification —
 * it is the same failure mode re-asked, and CLAUDE.md's standing rule says
 * so: "the correlated-error caveat travels with the numbers wherever they
 * are quoted." This module is that rule made a default rather than
 * something a caller has to remember to attach.
 *
 * Pure judgment only: which family answers is decided here from what the
 * caller already knows (the producer's family, and which other families are
 * actually reachable); which host adapter that family maps to, and whether
 * one is reachable at all today, is host-tier work this module never does.
 */

/** The house phrase, verbatim, so every quoted number carries the same words. */
export const CORRELATED_ERROR_CAVEAT =
  'the same family produced this deliverable and checked it; observed agreement is an upper bound on independent agreement';

export interface ChallengeFamilyChoice {
  /** The family the pass should be asked to run through, when one is known. */
  readonly family: string | null;
  /** True when the answer is same-family (or family-unknown) — a fallback, not a choice. */
  readonly sameFamily: boolean;
  /** Present exactly when `sameFamily` is true: append this to whatever the pass returns. */
  readonly caveat: string | null;
}

/**
 * Choose which family should answer a challenge or judge pass.
 *
 * `producerFamily` is the family that made the deliverable under check, read
 * from that dispatch's own adapter (see familyOf() in hosts/family.ts) — null
 * when the host would not say. `availableFamilies` is whatever the caller
 * can actually reach today; for every real call site in this codebase as of
 * this writing that list is empty, because a run dispatches through exactly
 * one host adapter and nothing here spawns a second one — so the honest
 * default is the fallback branch, every time, until a caller can genuinely
 * offer a second family.
 *
 * An unknown producer family is treated the same as a same-family answer,
 * not more favorably: this function never claims independence it cannot
 * show, and "the producer's family is unknown" is not evidence that some
 * other family differs from it.
 */
export function chooseChallengeFamily(input: {
  readonly producerFamily: string | null;
  readonly availableFamilies: readonly string[];
}): ChallengeFamilyChoice {
  if (input.producerFamily !== null) {
    const other = input.availableFamilies.find((family) => family !== input.producerFamily);
    if (other !== undefined) {
      return { family: other, sameFamily: false, caveat: null };
    }
  }
  return { family: input.producerFamily, sameFamily: true, caveat: CORRELATED_ERROR_CAVEAT };
}
