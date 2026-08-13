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
  /**
   * "a" or "an", for the sentence that names this shape aloud. Declared
   * rather than guessed from the first letter: "rfc" starts with a consonant
   * letter and a vowel sound ("ar-eff-see"), which is exactly the case a
   * spelling-based heuristic gets wrong.
   */
  readonly article: 'a' | 'an';
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
  article: 'a',
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
  article: 'a',
  sections: [
    { name: 'where-things-stand', expects: 'the position the choice is made from, only as the deliverables describe it' },
    { name: 'what-was-on-the-table', expects: 'the options the deliverables weighed, each with what would have recommended it' },
    { name: 'the-choice', expects: 'what the deliverables together support committing to, stated as a commitment' },
    { name: 'what-it-costs', expects: 'what stops, slips, or goes unstaffed to pay for it, where a deliverable says so' },
    { name: 'what-happens-first', expects: 'the order, and what must be true before the next thing starts' },
    { name: 'what-would-change-it', expects: 'what a reader could observe that would make this the wrong call' },
  ],
};

/**
 * The shape of a spec: what problem it solves, for whom, what it must do, and
 * what it deliberately leaves out.
 *
 * Asked for a PRD or a spec, the review shape answers a different question —
 * it reports what several concerns found, and a spec is not a report, it is
 * the thing engineering builds from. Every section here is something a reader
 * building from this document needs and review has no place for: who the
 * problem belongs to, because a requirement with no stated owner of the pain
 * is a solution looking for one; what is explicitly out, because a spec that
 * only says what it does invites scope to arrive by assumption; and open
 * questions kept as their own section rather than folded into requirements,
 * because a requirement stated with a question mark inside it is not a
 * requirement, it is the same gap wearing the shape of an answer.
 */
const SPEC: CompositionShape = {
  name: 'spec',
  answers: 'an ask to define what a feature or change must do before it is built',
  article: 'a',
  sections: [
    { name: 'the-problem', expects: 'what is broken or missing, and who it costs, only as the deliverables describe it' },
    { name: 'the-goal', expects: 'what success looks like, stated as an outcome rather than a task' },
    { name: 'requirements', expects: 'what the solution must do, each tied to the role that established it' },
    { name: 'non-goals', expects: 'what this deliberately does not cover, where a deliverable says so' },
    { name: 'open-questions', expects: 'what the deliverables raised and left unresolved, kept as questions rather than folded into a requirement' },
    { name: 'risks', expects: 'what could go wrong, where a deliverable names it' },
  ],
};

/**
 * The shape of an RFC: one proposed approach, argued against the alternatives
 * it was chosen over, put up for someone else to object to.
 *
 * Close to DECISION and easy to conflate with it, so the distinction is the
 * point. A decision states a commitment, what it costs, and what happens
 * first — it is post-commitment, written for someone about to act on it. An
 * RFC proposes one approach and justifies it against the others that were on
 * the table — it is pre-commitment, written for someone who might still
 * reject it, and asking it to state a cost or a sequence would be asking it
 * to commit on the reader's behalf before the reader has said yes. That is
 * why this shape has no what-it-costs or what-happens-first: those questions
 * belong to the decision this document is asking someone else to make.
 */
const RFC: CompositionShape = {
  name: 'rfc',
  answers: 'an ask to propose one approach and put it up for objection before it is chosen',
  article: 'an',
  sections: [
    { name: 'the-proposal', expects: 'the one approach being proposed, stated plainly as a specific course of action' },
    { name: 'why-now', expects: 'what is driving the need for this decision, only as the deliverables describe it' },
    { name: 'alternatives-considered', expects: 'other approaches weighed and why this one over them, each tied to the role that established it' },
    { name: 'tradeoffs', expects: 'what this approach costs or risks that a reader should weigh before agreeing to it' },
    { name: 'open-questions', expects: 'what the proposal leaves for the reader to resolve, kept as questions rather than answered over' },
    { name: 'out-of-scope', expects: 'what this proposal deliberately does not address, where a deliverable says so' },
  ],
};

export const COMPOSITION_SHAPES: readonly CompositionShape[] = [REVIEW, DECISION, SPEC, RFC];

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

/**
 * The words a person uses naming the document type itself rather than the
 * judgment it takes to write one — kept narrower than DECISION_SIGNALS for
 * the same reason "plan" is absent there: a chooser that fires on "spec"
 * appearing anywhere would catch "let's spec out what we found" (a review of
 * findings) as often as an actual ask for one.
 */
const SPEC_SIGNALS = [
  'write a prd', 'write a spec', 'a prd for', 'a spec for', 'product requirements',
  'requirements doc', 'write the requirements', 'define requirements', 'spec out',
  'specification for', 'draft a prd', 'draft a spec',
];

/**
 * The words a person uses asking for a proposal put up for someone else to
 * object to, rather than a finished commitment. Kept as specific as
 * SPEC_SIGNALS and for the same reason — "propose" alone is too common a verb
 * to trust ("propose a fix" is often just a review with a recommendation in
 * it), so the phrases here name the document, not the act of suggesting
 * something.
 */
const RFC_SIGNALS = [
  'write an rfc', 'draft an rfc', 'an rfc for', 'rfc for', 'request for comments',
  'request for comment', 'write a proposal for', 'draft a proposal for', 'a design proposal',
];

/**
 * Which shape an outcome asks for. Falls to the review shape by design.
 *
 * RFC and spec are both checked before decision, and RFC before spec: "write
 * an RFC deciding which of two approaches to take" or "an RFC for the export
 * tool's requirements" name the document type over the judgment or the
 * neighbouring document type in the same breath, and the document type is
 * what a reader would notice missing — a decision-shaped document with no
 * alternatives-considered section is not the RFC that was asked for, and a
 * spec's requirements read differently from an RFC's proposal even when both
 * describe the same feature.
 */
export function shapeForOutcome(outcome: string): CompositionShape {
  const text = outcome.toLowerCase();
  if (RFC_SIGNALS.some((signal) => text.includes(signal))) return RFC;
  if (SPEC_SIGNALS.some((signal) => text.includes(signal))) return SPEC;
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
