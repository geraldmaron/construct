/**
 * kernel/run/accountability.ts — the two things the work log has to carry
 * beyond "a role ran": what was flagged, and what needs a licensed human.
 *
 * Commitment 4 says invocation is invisible but accountability never is, and
 * commitment 15 says nothing is asserted that cannot be supported. Those two
 * together decide the shape of this module: every flag below is read off what
 * the host itself reported, never inferred from the wording of a deliverable.
 * "The role sounded uncertain" is not a fact this system has; "the role's file
 * read failed and it answered anyway" is.
 *
 * Licensed review works the other way round — it is a property of the domain,
 * declared in the catalog, not a judgment about a particular deliverable. A
 * privacy issue-spot needs an attorney's eyes whether or not the issue-spot
 * itself sounds alarming, and deciding case by case would make the safeguard
 * depend on the very output it is meant to qualify (STRATEGY risk 3).
 */

import { DOMAINS, domainsByName } from '../implication/domains.ts';
import type { Domain } from '../implication/domains.ts';


export const CONCERN_KINDS = ['incomplete-inputs', 'empty-deliverable', 'truncated'] as const;

export type ConcernKind = (typeof CONCERN_KINDS)[number];

export interface Concern {
  readonly kind: ConcernKind;
  /** Why, in the user's words. */
  readonly detail: string;
  /** The host-reported fact behind it. Never a paraphrase of the deliverable. */
  readonly evidence: unknown;
}

interface Reported {
  readonly text?: unknown;
  readonly failedToolCalls?: unknown;
  readonly finishReasons?: unknown;
}

/**
 * What is wrong with a deliverable, judged only from what the host reported
 * about producing it.
 *
 * Takes the deliverable rather than the whole host result so the same function
 * answers for a stored one — a task read back out of the store must produce the
 * same flags it produced when it settled, and two code paths for that would
 * eventually disagree.
 *
 * Deliberately three narrow checks rather than a general quality read. A role
 * that could not open the document it was asked about, one that returned
 * nothing, and one that was cut off mid-answer are all cases where the
 * deliverable is standing on less than it appears to be — and all three are
 * facts the host states outright.
 */
export function deliverableConcerns(deliverable: unknown): Concern[] {
  const output = deliverable as Reported | null;
  const concerns: Concern[] = [];

  const failed = Array.isArray(output?.failedToolCalls) ? output.failedToolCalls : [];
  if (failed.length > 0) {
    concerns.push({
      kind: 'incomplete-inputs',
      detail: `answered despite ${String(failed.length)} failed tool call(s) — it could not read everything it reached for`,
      evidence: failed,
    });
  }

  const text = typeof output?.text === 'string' ? output.text : '';
  if (text.trim() === '') {
    concerns.push({
      kind: 'empty-deliverable',
      detail: 'the run succeeded but produced no text',
      evidence: { chars: text.length },
    });
  }

  // 'length' is the finish reason for hitting the output limit. Other reasons
  // are left alone: an unfamiliar one is not evidence of anything, and guessing
  // at its meaning is the invention half of commitment 15.
  const reasons = Array.isArray(output?.finishReasons) ? output.finishReasons : [];
  if (reasons.includes('length')) {
    concerns.push({
      kind: 'truncated',
      detail: 'the answer was cut off at the output limit, so it is not the whole answer',
      evidence: { finishReasons: reasons },
    });
  }

  return concerns;
}

/**
 * The profession that must review this role's output before anyone relies on
 * it, or null when the domain does not call for one. Declared in the catalog —
 * see the module note on why this is not a per-deliverable judgment.
 */
export function licensedReviewFor(
  role: string,
  catalog: readonly Domain[] = DOMAINS,
): string | null {
  return domainsByName(catalog).get(role)?.licensedReview ?? null;
}
