/**
 * kernel/run/contested.ts — two roles describing the same thing as being in two
 * different states, in one document, unreconciled.
 *
 * The stance protocol next door refuses to read a position out of prose, and
 * that refusal is right: "this is concerning" and "this is fine" are not
 * reliably separable, and a matcher that got it wrong would invent a conflict or
 * bury one. Nothing here weakens that. A stance is about a judgement — should we
 * proceed — and judgement is what a role must declare rather than have inferred.
 *
 * This is a narrower question with a decidable answer. Two roles named the same
 * referent, and one wrote that a change to it still has to happen while the
 * other wrote that it already had:
 *
 *   program-sequencing: "re-point any Firestore-backed switch to
 *                        bb_ops.kill_switches before the beta-disable gate can
 *                        be trusted"
 *   product-scoping:    "firebase-wind-down.md shows kill switches already
 *                        moved to bb_ops.kill_switches"
 *
 * Both were composed into one document, adjacent, and nothing noticed. One of
 * them is wrong, and which one decides whether a step at the top of the
 * recommended order is necessary work or work already done. That is not a
 * matter of opinion the reader should be left to arbitrate silently.
 *
 * WHAT MAKES IT DECIDABLE. Not the sentiment, which is exactly what cannot be
 * read. Three things that are all surface facts: the two claims come from
 * different roles, they name the same referent by an identifier the ground
 * would resolve, and one carries a pending marker while the other carries a
 * completion marker. Any of the three missing and nothing is reported.
 *
 * WHAT IT DOES WITH ONE. Surfaces the pair, both claims, both names, and stops.
 * Resolution is refused for the same reason the closing round refuses it on a
 * contested gap: the run has no standing to decide which of two roles read the
 * ground correctly, and picking by order of arrival would put one side of a
 * live disagreement in a document under a single name and call it the answer.
 * The reader needs to know the question has two answers far more than they need
 * one of them presented as settled.
 *
 * DELIBERATELY QUIET. A pair that is merely two roles discussing the same file
 * is not reported, because most co-mentions are complementary and a surface
 * that flagged them all would be skipped within a week. The cost of a miss here
 * is a contradiction the reader has to catch; the cost of a flood is a
 * contradiction the reader stops looking for.
 */

/** One claim as the composition holds it: the text, and whose it is. */
export interface AttributedClaim {
  readonly text: string;
  readonly from: string;
}

/**
 * A referent as a role names one: a path, a qualified name, or an identifier
 * in code casing. The same three shapes the handback check reads, because "a
 * thing in the ground the reader could go and look at" is one idea and two
 * matchers for it would disagree eventually.
 */
const REFERENT =
  /\b(?:(?:[\w.@-]+\/)+[\w.@-]+\.[a-z]{1,5}|[a-z_][a-z0-9_]{2,}\.[a-z_][a-z0-9_]{2,}|[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;

/**
 * The change has not happened. Written as things a role says when it is asking
 * for work: an instruction to change something, or a statement that the current
 * state is the old one.
 */
const PENDING =
  /\b(?:re-?point|migrat(?:e|ing)|mov(?:e|ing)\s+(?:it\s+)?to|switch(?:ing)?\s+(?:it\s+)?to|redirect|must\s+(?:be\s+)?\w+|need(?:s)?\s+to\s+be|should\s+be|has\s+to\s+be|before\s+\w+|not\s+yet|still\s+(?:targets?|reads?|points?|uses?|describes?)|remains?\s+on|is\s+scheduled)\b/i;

/**
 * The change has happened. The mirror set: a role reporting a completed state.
 */
const COMPLETED =
  /\b(?:already\s+\w+|has\s+(?:been\s+)?(?:moved|migrated|removed|switched|repointed)|have\s+(?:been\s+)?(?:moved|migrated|removed|switched)|was\s+(?:moved|migrated|removed|switched)|were\s+(?:moved|migrated|removed)|no\s+longer\s+\w+|is\s+now\s+\w+|are\s+now\s+\w+|structurally\s+removed|has\s+moved)\b/i;

/** Two claims that cannot both be describing the same state of one referent. */
export interface ContestedFact {
  /** The referent both claims name. */
  readonly referent: string;
  /** The claim saying the change still has to happen. */
  readonly pending: AttributedClaim;
  /** The claim saying it already has. */
  readonly completed: AttributedClaim;
}

function referentsIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(REFERENT)) found.add(match[0]);
  return found;
}

/**
 * Pairs of claims from different roles that describe one referent as being in
 * two states.
 *
 * At most one pair per referent. A document in which four claims touch the same
 * table needs the reader to know the table is contested, not to read six
 * combinations of the same disagreement.
 */
export function contestedFacts(claims: readonly AttributedClaim[]): ContestedFact[] {
  const read = claims.map((claim) => ({
    claim,
    referents: referentsIn(claim.text),
    pending: PENDING.test(claim.text),
    completed: COMPLETED.test(claim.text),
  }));

  const found: ContestedFact[] = [];
  const reported = new Set<string>();
  for (const a of read) {
    // A claim carrying both markers is describing a sequence ("it has moved and
    // must now be re-pointed"), which is a coherent sentence and not a
    // disagreement with itself.
    if (!a.pending || a.completed) continue;
    for (const b of read) {
      if (!b.completed || b.pending) continue;
      if (a.claim.from === b.claim.from) continue;
      for (const referent of a.referents) {
        if (!b.referents.has(referent) || reported.has(referent)) continue;
        reported.add(referent);
        found.push({ referent, pending: a.claim, completed: b.claim });
      }
    }
  }
  return found;
}

/**
 * The pair as a reader meets it.
 *
 * Written as a question rather than a finding, because the check knows the two
 * sentences cannot both be current and does not know which is. Naming both
 * roles is the point: the reader can go to either.
 */
export function contestedLine(fact: ContestedFact): string {
  return (
    `${fact.referent}: ${fact.pending.from} writes that this change still has to happen, ` +
    `and ${fact.completed.from} writes that it already has. Both read the same ground and ` +
    'only one of these is current.'
  );
}
