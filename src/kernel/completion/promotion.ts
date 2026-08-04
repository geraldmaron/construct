/**
 * kernel/completion/promotion.ts — `draft -> challenged -> final`, and the
 * written decision about how it relates to the twelve-rung ladder next door.
 *
 * THE DECISION (construct-r67.13). They are two axes, not two views of one.
 * Neither is a coarser rendering of the other, and nothing maps between them.
 *
 *   states.ts is PRODUCTION evidence: planned, authored, exported, renderable,
 *   screenshot-captured, accessibility-reviewed, and so on. Every rung answers
 *   "what has been done to this deliverable, and can it be re-verified?"
 *
 *   this file is RELIANCE: has the deliverable been adversarially challenged,
 *   and did it survive? Every state answers "may anyone act on this yet?"
 *
 * The tempting reading — that draft/challenged/final is a coarse gate layered
 * over the twelve rungs, with `challenged` covering the review rungs and `final`
 * meaning `approved` — was considered and rejected on the merits. Those rungs
 * are production checks: does the file render, does the contrast pass. A brief's
 * challenges are content-level: the strongest objection documented, a pre-mortem
 * on the plan, a citation or [unverified] tag on every claim, a scope diff
 * against the brief (commitment 13). Mapping the two would let a deliverable be
 * promoted because a screenshot was captured, which is precisely the ungated
 * promotion commitment 14 exists to prevent. A deliverable can be `exported` and
 * never challenged; it can be challenged while merely `authored`. Both are
 * normal, and a model that cannot express both is wrong.
 *
 * So: the twelve rungs stay deliverable-production detail with their own
 * evidence ledger, commitment 14 governs this separate promotion state, and
 * neither module imports the other.
 *
 * The state is DERIVED, never stored and never set. That is not a style
 * preference — it is the mechanism. Commitment 14 exists because an ungated
 * write surface let a role under completion pressure mark its own challenge
 * passed in the predecessor, and the durable fix is that there is no setter to
 * reach: promotion is a function of recorded verdicts, so the only way to move
 * it is to produce a verdict, and a verdict a role recorded about its own work
 * does not count (see `promotionState`). Enforcing that at the token layer as
 * well is construct-r67.6's job; enforcing it here means the invariant holds
 * even for a caller that never sees a token.
 */

export const PROMOTION_STATES = ['draft', 'challenged', 'final'] as const;

export type PromotionState = (typeof PROMOTION_STATES)[number];

export const VERDICT_OUTCOMES = ['passed', 'failed', 'waived'] as const;

export type VerdictOutcome = (typeof VERDICT_OUTCOMES)[number];

export interface Verdict {
  /** The challenge id the brief named. */
  readonly challenge: string;
  readonly outcome: VerdictOutcome;
  /**
   * Who recorded it: a second role for a substantive pass, the dispatcher for a
   * deterministic structural check, the user for a waiver. Never the role whose
   * deliverable is under review — commitment 13 puts waivers with the user
   * alone, and commitment 14 puts the transition with the dispatcher.
   */
  readonly by: string;
}

export interface PromotionInput {
  /** The role that produced the deliverable. Its own verdicts do not count. */
  readonly role: string;
  /** Challenge ids that must be answered before this can pass `draft`. */
  readonly required: readonly string[];
  readonly verdicts: readonly Verdict[];
}

export interface Promotion {
  readonly state: PromotionState;
  /** Required challenges with no surviving verdict yet. */
  readonly outstanding: readonly string[];
  /** Challenges answered `failed` and not waived. */
  readonly failing: readonly string[];
  /**
   * Verdicts discarded because the role recorded them about its own work. Kept
   * rather than dropped silently: an attempt to self-promote is exactly the
   * event commitment 14 wants visible, and a caller logs these.
   */
  readonly rejected: readonly Verdict[];
}

/**
 * Derive the promotion state from what has actually been recorded.
 *
 * A deliverable with no required challenges stays a draft. That is deliberate:
 * "nobody challenged it" and "it survived challenge" must not produce the same
 * answer, and a vacuous truth promoting a deliverable to final would be the
 * quietest possible version of the failure this state exists to prevent.
 *
 * `failed` holds at `challenged` rather than falling back to `draft`. The
 * challenge did happen and the deliverable did not survive it; erasing that
 * back to draft would lose the most useful fact in the record.
 */
export function promotionState(input: PromotionInput): Promotion {
  const rejected = input.verdicts.filter((verdict) => verdict.by === input.role);
  const counted = input.verdicts.filter((verdict) => verdict.by !== input.role);

  // Last verdict per challenge wins: a re-run after a fix supersedes its own
  // earlier result, the same way a lesson supersedes without overwriting.
  const latest = new Map<string, Verdict>();
  for (const verdict of counted) latest.set(verdict.challenge, verdict);

  const outstanding = input.required.filter((challenge) => !latest.has(challenge));
  const failing = input.required.filter((challenge) => latest.get(challenge)?.outcome === 'failed');

  if (input.required.length === 0 || outstanding.length > 0) {
    return { state: 'draft', outstanding, failing, rejected };
  }
  if (failing.length > 0) {
    return { state: 'challenged', outstanding, failing, rejected };
  }
  return { state: 'final', outstanding, failing, rejected };
}

export function isPromotionState(state: unknown): state is PromotionState {
  return typeof state === 'string' && (PROMOTION_STATES as readonly string[]).includes(state);
}
