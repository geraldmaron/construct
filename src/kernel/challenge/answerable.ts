/**
 * kernel/challenge/answerable.ts — whether the questions a deliverable hands
 * back are questions, or work.
 *
 * The ground-exhaustion rule already says the thing this checks: a role that can
 * name where the answer is, inside a root it was licensed to read, has found
 * work rather than a question, and writing it down as open leaves the reader
 * holding the same question, the same license, and less context. The gate built
 * for that rule is path-shaped — it fires on a file path named in the
 * deliverable and never cited. The cop-out is question-shaped and walks past it.
 *
 * From one recorded run, every one of these passed every gate:
 *
 *   "Confirm, against the actual kill-switch code, which store each
 *    containment-order switch reads from today."
 *   "Confirm whether commitCanonicalWrite's merge branch calls
 *    assertNoCrossSourceProfileAggregation."
 *   "Determine whether bb_canonical.claims being empty is a scheduled
 *    migration gap or a permanent bypass."
 *
 * Each is a search inside a repository the run held a license to read. None
 * names a file path, so the path-shaped gate saw nothing. Four of five items in
 * that document's "what happens first" were of this kind: the run found the
 * work, wrote it as a question, and handed it to the person who had asked it to
 * do the work.
 *
 * WHAT THIS REFUSES TO FLAG, AND WHY THAT MATTERS MORE THAN WHAT IT CATCHES.
 * Most open questions are honest and closing them is not the role's to do:
 * whether counsel has reviewed a posture, whether a dormant capability is a
 * live proposal, what the funding allocation is, what a person intends. Those
 * questions belong in the reader's hands and a check that dragged them back
 * would teach roles to stop asking — which costs far more than this catches.
 * So the trigger is a conjunction and both halves must hold: the sentence has
 * to be a handback, AND it has to name something a search over the declared
 * ground would settle. A question about intent names no such thing and is never
 * flagged, however uncertain it sounds.
 *
 * The check is about the referent, never about the answer. It cannot tell
 * whether the grep would have found anything, and it does not claim to: what it
 * asserts is that the role named a place to look and did not say it looked.
 * Saying so is enough to pass, including saying the search came back empty —
 * "no such call exists in the merge branch" is an answer, and so is "I searched
 * and could not reach the file."
 */

import type { ChallengeCheck } from './catalog.ts';

/**
 * A sentence that puts a question to the reader.
 *
 * Two shapes, because roles write handbacks both ways: an imperative addressed
 * to whoever reads it ("confirm whether..."), and a declared uncertainty
 * ("it is unclear whether..."). Deliberately not triggered by a bare question
 * mark — a deliverable that asks a rhetorical question in its reasoning is not
 * handing anything back.
 */
const HANDBACK =
  /\b(?:confirm|determine|verify|establish|check|resolve|clarify|ascertain)\b(?=[^.\n]*\b(?:whether|which|if|that|what|how|where)\b)|\b(?:is|are|remains?|stays?|left)\s+(?:currently\s+)?(?:unclear|unknown|unconfirmed|undetermined|unverified|unresolved|open)\b|\b(?:not|never)\s+(?:been\s+)?(?:confirmed|verified|checked|established|determined)\b|\bwould\s+need\s+(?:to\s+be\s+)?(?:confirmed|verified|checked)\b|\bcould\s+not\s+(?:be\s+)?(?:confirm|confirmed|verify|verified|determine|determined)\b/i;

/**
 * A code symbol as a role writes one in prose: an identifier carrying an
 * internal capital or an underscore, long enough not to be an initialism.
 *
 * Anchored on the shape rather than on a list, because the whole value of this
 * signal is that it works over ground the kernel has never seen. `slice` and
 * `API` are not symbols by this rule and `commitCanonicalWrite` and
 * `assert_no_cross_source` are, which is the line that matters: a name written
 * in code casing came from code the writer was looking at.
 */
const CODE_SYMBOL = /\b(?:[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*){1,}|[a-z][a-z0-9]*(?:_[a-z0-9]+){1,})\b/;

/**
 * A qualified name — schema.table, module.member — which is a place in the
 * ground however it is cased.
 */
const QUALIFIED_NAME = /\b[a-z_][a-z0-9_]{2,}\.[a-z_][a-z0-9_]{2,}\b/i;

/**
 * The answer's address, named as a kind rather than as a symbol.
 *
 * A sentence that says to check something "against the actual kill-switch code"
 * has told the reader exactly where the answer lives without naming one
 * identifier. The preposition is required: "the code is well tested" names no
 * search, and "in the migrations" does.
 */
const NAMED_GROUND =
  /\b(?:against|in|from|within|under|by\s+reading|by\s+checking|by\s+searching)\s+(?:the\s+)?(?:actual\s+|current\s+|live\s+|real\s+)?(?:[\w-]+\s+)?(?:code|codebase|source|implementation|schema|migrations?|config(?:uration)?|tests?|repo(?:sitory)?)\b/i;

/**
 * Whether the sentence already reports having gone and looked.
 *
 * Generous on purpose. Every honest ending passes: the search was done and
 * settled it, the search was done and did not settle it, or the ground could
 * not be reached and the sentence says so. What fails is naming the place and
 * stopping.
 */
const WENT_AND_LOOKED =
  /\[(?:cite|research):|\b(?:i\s+)?(?:read|opened|searched|grepped|checked|inspected|traced|reviewed|confirmed|looked\s+at)\b|\bno\s+(?:such|matching)\b|\breturns?\s+(?:no|nothing|zero)\b|\bcould not (?:be )?(?:read|open|access|retrieve)\b|\bunable to (?:read|open|access)\b|\bnot reachable\b|\boutside (?:the |my )?(?:declared |licensed )?(?:root|ground)\b|\bpermission denied\b|\bno such file\b/i;

/** One handback that named a place to look and did not say anyone looked. */
export interface UnearnedHandback {
  /** The sentence, trimmed, for the role to find in its own draft. */
  readonly sentence: string;
  /** What made it checkable: the symbol, qualified name, or named ground. */
  readonly referent: string;
}

/**
 * Sentences a deliverable hands back that a search over its own ground would
 * settle.
 *
 * Split on sentence boundaries and on list-item boundaries, because a handback
 * is as often a bullet as a sentence and a bullet frequently carries no
 * terminating period at all.
 */
export function unearnedHandbacks(deliverable: string): UnearnedHandback[] {
  const found: UnearnedHandback[] = [];
  const seen = new Set<string>();
  for (const raw of deliverable.split(/(?<=[.;!?])\s+|\n+/)) {
    const sentence = raw.replace(/^[\s>*_`#-]+/, '').trim();
    if (sentence.length === 0) continue;
    if (!HANDBACK.test(sentence)) continue;
    if (WENT_AND_LOOKED.test(sentence)) continue;
    const referent =
      QUALIFIED_NAME.exec(sentence)?.[0] ??
      CODE_SYMBOL.exec(sentence)?.[0] ??
      NAMED_GROUND.exec(sentence)?.[0] ??
      null;
    if (referent === null) continue;
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ sentence, referent });
  }
  return found;
}

/**
 * The check itself.
 *
 * Self-limiting the same way ground-exhaustion is: with no declared roots the
 * role had its listed documents and nothing else, so a question it could not
 * have searched is not a question it should have answered, and the check passes
 * saying so rather than inventing an obligation the dispatch never granted.
 */
export function handbacksEarned(
  deliverable: string,
  groundRoots: readonly string[] | undefined,
): ChallengeCheck {
  if (groundRoots === undefined || groundRoots.length === 0) {
    return {
      passed: true,
      detail:
        'no declared roots on this dispatch — there was no ground this role could have searched ' +
        'to answer its own questions',
    };
  }
  const unearned = unearnedHandbacks(deliverable);
  if (unearned.length === 0) {
    return {
      passed: true,
      detail:
        'every question handed back either names nothing searchable in the declared ground or ' +
        'says what the search found — whether the search was thorough is a substantive question ' +
        'this check cannot answer',
    };
  }
  const shown = unearned
    .slice(0, 2)
    .map((h) => `"${h.sentence.slice(0, 110)}" (names ${h.referent})`)
    .join('; ');
  const more = unearned.length > 2 ? ` (and ${String(unearned.length - 2)} more)` : '';
  return {
    passed: false,
    detail:
      `${String(unearned.length)} question(s) handed back name something a search of the declared ` +
      `ground would settle, with no sign anyone searched: ${shown}${more}. Run the search and ` +
      'report what it found — including that it found nothing, which is an answer. The reader ' +
      'has the same license and less context than you do.',
  };
}
