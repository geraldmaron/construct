/**
 * kernel/run/closing.ts — the round that goes and answers what the composition
 * said nobody answered.
 *
 * A composed document ends with the gaps it found, and until now that list was
 * the last thing the run did with them: printed, handed back, done. It reads as
 * rigour and it is often the opposite. A gap the run identified from material
 * it holds, in a root its roles were licensed to read, is work that was
 * available and was not done — and the reader who receives it has exactly the
 * material, the license and the question the role had, plus less context.
 *
 * So the gaps go back to the people who might close them. Not to a new
 * classifier role deciding who owns what: each role that produced a deliverable
 * is shown the whole list and asked which of it *its own* material settles,
 * which keeps the two properties the spine will not trade. Attribution stays
 * intact, because the role that closes a gap is the role whose name goes on the
 * answer. And no new concern is invented, because nobody is asked about
 * anything outside what they were already dispatched for.
 *
 * Three bounds, each load-bearing:
 *
 *   - ONE ROUND. A closing answer never generates another closing round. The
 *     same stop rule the research rung has, for the same reason: the cheapest
 *     thing a model can do with a hard question is look at it again, and a run
 *     that keeps closing its own gaps never delivers.
 *   - VERBATIM GAPS ONLY. A closing answer names the gap it closes by the text
 *     the composition wrote. An answer to a gap nobody listed is refused the
 *     way a claim attributed to an absent role is refused — it is the same
 *     failure, an addition wearing the shape of an arrangement.
 *   - THE ROLE'S ATTRIBUTION. These claims never pass through the composer, so
 *     there is nothing for the support screen to catch: the screen exists
 *     because arranging is where an added sentence hides, and nothing is being
 *     arranged here. They carry the role's name because they answer that role's
 *     obligation, written in Construct's voice like every other line.
 */

import { challengeById, runStructuralChallenges } from '../challenge/catalog.ts';
import type { Brief } from '../brief/schema.ts';
import type { SourceDeliverable } from './compose.ts';

/** One gap a role says its material settles, and what it says the material says. */
export interface ClosedGap {
  /** The gap text, exactly as the composition wrote it. */
  readonly gap: string;
  /** The role whose material settled it. */
  readonly role: string;
  /** What that material says, in Construct's voice, carrying this role's name. */
  readonly answer: string;
}

/** One gap a role looked at and could not settle, with the reason. */
export interface UnclosedGap {
  readonly gap: string;
  readonly role: string;
  /** Why the material does not settle it — a fact about the ground, not a shrug. */
  readonly reason: string;
}

export interface ClosingReply {
  readonly closed: readonly ClosedGap[];
  readonly unclosed: readonly UnclosedGap[];
  /** Answers refused before anyone read them, each with its reason. */
  readonly refused: readonly { readonly gap: string; readonly reason: string }[];
}

/**
 * A role shown the gaps and asked which its material closes. Throws on host
 * failure; a closing round that could not run leaves the gaps standing, which
 * is the state the document was already in.
 */
export type GapCloser = (
  source: SourceDeliverable,
  gaps: readonly string[],
) => Promise<ClosingReply>;

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Read one role's closing reply, refusing answers to gaps that were never
 * listed.
 *
 * Matching is on the gap text the composition produced, normalised for
 * whitespace and case only. Nothing looser: a fuzzy match here would let a
 * model answer a question adjacent to the one asked and have the kernel file it
 * as the answer to the real one, which is precisely the substitution the
 * unmet-concern record exists to make visible rather than convenient.
 */
export function toClosingReply(
  parsed: unknown,
  role: string,
  gaps: readonly string[],
): ClosingReply {
  const listed = new Map(gaps.map((gap) => [normalise(gap), gap]));
  const closed: ClosedGap[] = [];
  const unclosed: UnclosedGap[] = [];
  const refused: { gap: string; reason: string }[] = [];
  const record = parsed as { closed?: unknown; unclosed?: unknown } | null;

  for (const item of Array.isArray(record?.closed) ? record.closed : []) {
    const entry = item as { gap?: unknown; answer?: unknown } | null;
    const gap = asString(entry?.gap);
    const answer = asString(entry?.answer);
    if (!gap || !answer) continue;
    const known = listed.get(normalise(gap));
    if (known === undefined) {
      refused.push({
        gap,
        reason:
          'answers a gap the composition did not name — a closing round may settle what was ' +
          'listed and may not add a question to answer it',
      });
      continue;
    }
    closed.push({ gap: known, role, answer });
  }

  for (const item of Array.isArray(record?.unclosed) ? record.unclosed : []) {
    const entry = item as { gap?: unknown; reason?: unknown } | null;
    const gap = asString(entry?.gap);
    const reason = asString(entry?.reason);
    if (!gap || !reason) continue;
    const known = listed.get(normalise(gap));
    if (known === undefined) continue;
    unclosed.push({ gap: known, role, reason });
  }

  return { closed, unclosed, refused };
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The checks a paragraph answering one question actually owes.
 *
 * A closing answer is new text and must be screened; that much was settled by
 * the argument below. What was wrong was screening it against every challenge
 * its author's whole deliverable owed. Those two sets are not the same, and the
 * difference is not cosmetic: over one recorded run, four of six closing answers
 * were discarded for having no labelled pre-mortem, no scope diff, or no
 * strongest objection — sections that mean something in a memo and nothing in a
 * two-sentence answer to "who owns this gap?". The run held four answers, failed
 * them on a heading, and printed "the gap stands" against questions it had just
 * closed. A gate that reports an absence the run had filled is worse than the
 * absence.
 *
 * What survives is every check about whether the answer is *sourced*, because
 * those are the ones a short answer can fail honestly: a claim asserted with no
 * citation is asserted with no citation whatever its length, and a document
 * named but never opened is the same unfinished work in a paragraph as in a
 * memo. What is dropped is every check about the shape a deliverable takes,
 * because an answer is not a deliverable and holding it to one grades the form
 * rather than the work.
 *
 * Which check is which is asked of the catalog rather than listed here. A list
 * kept beside the rule is the drift this project catches elsewhere: it would
 * still name two ids on the day a third sourcing check shipped, and the gap
 * would look exactly like a decision.
 */
function answerOwes(id: string): boolean {
  return challengeById(id)?.subject === 'sourcing';
}

/**
 * Hold a closing answer to the gates that mean something for an answer, before
 * it may enter the document.
 *
 * This is the correction to an argument that sounded right and was not. The
 * reasoning was that a closing answer needs no support screen because nothing
 * arranged it — the screen catches the composer adding, and the composer never
 * touches these. True, and beside the point: a closing answer is new text from
 * a fresh dispatch, and the composed document's entire claim is that every line
 * in it came from work that was checked. An unchecked paragraph admitted beside
 * checked ones inherits their credibility without having earned it, which is
 * the exact trade the composer's own discipline exists to refuse.
 *
 * A closing answer that asserts an uncited fact, or names a document it did not
 * open, is refused and the gap stays standing — which is the honest outcome:
 * the question is still open, and now the record says somebody tried.
 */
export function screenClosedAnswers(
  reply: ClosingReply,
  brief: Brief,
  groundRoots: readonly string[],
): ClosingReply {
  const owed: Brief = {
    ...brief,
    challenges: (brief.challenges ?? []).filter(answerOwes),
  };
  const closed: ClosedGap[] = [];
  const refused = [...reply.refused];
  for (const answer of reply.closed) {
    const run = runStructuralChallenges(owed, answer.answer, { groundRoots });
    const failed = run.results.filter((result) => !result.passed);
    if (failed.length > 0) {
      refused.push({
        gap: answer.gap,
        reason:
          `${answer.role}'s answer did not pass the checks its own deliverable owed ` +
          `(${failed.map((f) => `${f.challenge}: ${f.detail}`).join('; ')}) — the gap stands`,
      });
      continue;
    }
    closed.push(answer);
  }
  return { closed, unclosed: reply.unclosed, refused };
}

export interface ClosingRound {
  /** Every gap some role settled, in the order the composition listed them. */
  readonly closed: readonly ClosedGap[];
  /**
   * The gaps still standing, each with the reasons the roles that looked gave.
   * A gap nobody looked at carries no reasons, and that is a different state
   * from a gap several roles looked at and could not settle.
   */
  readonly standing: readonly {
    readonly gap: string;
    readonly reasons: readonly UnclosedGap[];
  }[];
  /**
   * Gaps more than one role answered, with every answer.
   *
   * Surfaced rather than resolved. Two roles answering the same question from
   * their own material is a disagreement, and the run has no standing to
   * settle it by arrival order — the reader needs to know the question has two
   * answers far more than they need one of them presented as the answer.
   */
  readonly contested: readonly {
    readonly gap: string;
    readonly answers: readonly ClosedGap[];
  }[];
  readonly refused: readonly { readonly gap: string; readonly reason: string }[];
}

/**
 * Fold every role's reply into one round.
 *
 * A gap one role answered is closed. A gap two roles answered is contested and
 * reported as contested, never resolved here: picking the first arrival and
 * printing it alone would put one side of a disagreement in the document under
 * a single name and call it the answer, which is the failure the stance
 * protocol and the conflict framing exist to prevent everywhere else in the
 * spine. Ordering inside a contested gap is the order the roles were asked,
 * which carries no authority and is not presented as carrying any.
 */
export function foldClosingRound(
  gaps: readonly string[],
  replies: readonly ClosingReply[],
): ClosingRound {
  const answers = new Map<string, ClosedGap[]>();
  const reasons = new Map<string, UnclosedGap[]>();
  const refused: { gap: string; reason: string }[] = [];

  for (const reply of replies) {
    for (const answer of reply.closed) {
      (answers.get(answer.gap) ?? setDefault(answers, answer.gap)).push(answer);
    }
    for (const stuck of reply.unclosed) {
      (reasons.get(stuck.gap) ?? setDefault(reasons, stuck.gap)).push(stuck);
    }
    refused.push(...reply.refused);
  }

  const closed: ClosedGap[] = [];
  const contested: { gap: string; answers: readonly ClosedGap[] }[] = [];
  const standing: { gap: string; reasons: readonly UnclosedGap[] }[] = [];
  for (const gap of gaps) {
    const given = answers.get(gap) ?? [];
    if (given.length === 1) closed.push(given[0]);
    else if (given.length > 1) contested.push({ gap, answers: given });
    else standing.push({ gap, reasons: reasons.get(gap) ?? [] });
  }

  return { closed, standing, contested, refused };
}

function setDefault<T>(map: Map<string, T[]>, key: string): T[] {
  const list: T[] = [];
  map.set(key, list);
  return list;
}
