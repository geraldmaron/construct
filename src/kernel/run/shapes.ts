/**
 * kernel/run/shapes.ts — what shape of document the ask wants back.
 *
 * A composition had one shape: what the answer is, what each concern
 * established, where they disagree, what follows. It is a good shape and it is
 * the shape of a review — the right answer when the ask was "look at this and
 * tell me what you find". It was also the answer when the ask was "decide what
 * we commit to over the next two releases, and what we stop investing in", and
 * there it produced a document with no statement of where the project stands,
 * no comparison of the options it dismissed, no sequence, and a first answer
 * that was a control gap to close rather than a commitment to make. Every claim
 * in it was true. The reader had asked a different question.
 *
 * So the shape follows from the ask. Three rules keep that from becoming a
 * licence.
 *
 *   1. THE KERNEL CHOOSES, NOT THE COMPOSER. A composer that picks its own
 *      headings is choosing what the document argues, which is the authorship
 *      the no-adding rule exists to deny it. The choice is made here, from the
 *      recorded outcome, before any model sees the deliverables.
 *   2. THE DEFAULT IS WHAT HAPPENS TODAY. An ask that does not clearly want
 *      another shape gets the review shape unchanged. This is a widening of
 *      what compose can produce, never a reinterpretation of what it already
 *      produces.
 *   3. A SHAPE IS A SET OF QUESTIONS, NOT A PROMISE TO ANSWER THEM. Sections
 *      the deliverables cannot fill are reported empty with the shape named, in
 *      exactly the way the review shape already reports an empty
 *      where-they-disagree. A shape that quietly drops its unfillable sections
 *      would let the document look complete by having asked less.
 *
 * The chooser is deterministic keyword matching, which is the same instrument
 * the implication map uses to read an outcome without paying for a model, and
 * it carries the same limits. It is wrong sometimes. That costs a flag rather
 * than a document, because the chosen shape is printed and `--shape` overrides
 * it — an inference the user can see and correct is a different thing from one
 * they cannot.
 */

export interface CompositionSection {
  readonly name: string;
  readonly expects: string;
}

export interface CompositionShape {
  readonly name: string;
  /** What kind of ask this shape answers, for the header and the usage line. */
  readonly answers: string;
  readonly sections: readonly CompositionSection[];
}

/**
 * The shape of a review: what was found, by whom, and what follows from it.
 *
 * The default, and the right answer whenever the ask is to look at something
 * and report. Its sections are ordered by what a reader wants first — the
 * answer, then the substance behind it — rather than by how the work happened.
 */
const REVIEW: CompositionShape = {
  name: 'review',
  answers: 'an ask to look at something and report what is there',
  sections: [
    { name: 'the-answer', expects: 'what the roles together actually answer, stated first and plainly' },
    { name: 'what-each-concern-established', expects: 'the substance each role contributed, in its own terms' },
    { name: 'where-they-disagree', expects: 'points two deliverables cannot both be acted on, or "none" explicitly' },
    { name: 'what-follows', expects: 'the actions the deliverables together support, only where they say so' },
  ],
};

/**
 * The shape of a decision: a choice, its price, and what happens first.
 *
 * Every section here is a question the reader of a decision asks and the review
 * shape never poses. Where things stand, because a choice with no stated
 * starting position cannot be argued with. What else was on the table, because
 * a recommendation that never names its alternatives has not been chosen
 * between. What it costs, because the work that stops is the part a plan hides.
 * And what would change it, because a decision nobody can falsify is a
 * preference.
 */
const DECISION: CompositionShape = {
  name: 'decision',
  answers: 'an ask to choose, commit, prioritise, or say what stops',
  sections: [
    { name: 'where-things-stand', expects: 'the position the choice is made from, only as the deliverables describe it' },
    { name: 'what-was-on-the-table', expects: 'the options the deliverables weighed, each with what would have recommended it' },
    { name: 'the-choice', expects: 'what the deliverables together support committing to, stated as a commitment' },
    { name: 'what-it-costs', expects: 'what stops, slips, or goes unstaffed to pay for it, where a deliverable says so' },
    { name: 'what-happens-first', expects: 'the order, and what must be true before the next thing starts' },
    { name: 'what-would-change-it', expects: 'what a reader could observe that would make this the wrong call' },
  ],
};

export const COMPOSITION_SHAPES: readonly CompositionShape[] = [REVIEW, DECISION];

export const DEFAULT_SHAPE = REVIEW;

/**
 * The words a person uses when they are asking to be committed to something
 * rather than informed about it.
 *
 * Kept to phrasings that carry the ask on their own. "Plan" is deliberately
 * absent: half its uses are "tell me what the plan is", which is a review, and
 * a chooser that gets the common case wrong costs more than one that declines
 * to guess.
 */
const DECISION_SIGNALS = [
  'decide', 'decision on', 'choose', 'which should', 'what should we',
  'commit to', 'commitment', 'prioriti', 'deprioriti', 'trade-off', 'tradeoff',
  'stop investing', 'stop doing', 'what to stop', 'invest in', 'bet on',
  'earns the next', 'next block of work', 'pick between', 'go/no-go', 'whether to',
];

/** Which shape an outcome asks for. Falls to the review shape by design. */
export function shapeForOutcome(outcome: string): CompositionShape {
  const text = outcome.toLowerCase();
  if (DECISION_SIGNALS.some((signal) => text.includes(signal))) return DECISION;
  return DEFAULT_SHAPE;
}

/** A shape by name, for the flag that overrides the inference. */
export function shapeByName(name: string): CompositionShape | undefined {
  return COMPOSITION_SHAPES.find((shape) => shape.name === name.trim().toLowerCase());
}

/** The names a user may pass, for the usage line. */
export function shapeNames(): string[] {
  return COMPOSITION_SHAPES.map((shape) => shape.name);
}
