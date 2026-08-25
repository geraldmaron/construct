/**
 * kernel/run/estimative.ts — how a finding says how likely something is, and
 * separately how much its basis is worth.
 *
 * Two statements, never one. A likelihood is a claim about the world: this
 * outcome happens, in this band, settled by this observation, by this date. A
 * confidence is a claim about the basis behind that claim: how much
 * information there was, how much method was applied to it, how volatile the
 * thing being judged is. Collapsing them produces the sentence everybody
 * writes and nobody can check — "we are fairly confident this is likely" —
 * where a reader cannot tell whether the hedge is about the world or about the
 * evidence. ICD 203 forbids the combination in one sentence for exactly that
 * reason, and this module is built so the combination cannot be assembled by
 * accident.
 *
 * WHY THE MODEL NEVER PICKS THE WORD. The band lexicon is a mapping from an
 * integer to a phrase, and the mapping is arithmetic, so code owns it. A model
 * asked for the phrase directly supplies its own reading of the phrase, and
 * those readings are measured to disagree with human readings on most of the
 * lexicon (Tang, Shen and Kejriwal, arXiv:2405.15185, report GPT-4 diverging
 * on 12 of 17 estimative terms). The assignment asks for a whole number; the
 * band is derived here. That is also why the number is what gets stored: a
 * band is a rendering of an integer, and a calibration curve needs the
 * integer.
 *
 * WHY THE NUMBER IS ALWAYS PRINTED BESIDE THE WORD. Readers given a bare
 * estimative word regress it toward even odds — a "very likely" read as though
 * it were nearer 50% than the writer meant (Budescu, Broomell and Por,
 * Psychological Science, 2009). Printing "likely (55–80%)" costs six
 * characters and removes the whole failure. `renderLikelihood` is the only way
 * this module will produce a band word, and it will not produce one alone.
 *
 * WHY SEVEN BANDS AND NOT THREE. Rounding an assessor's real belief to one of
 * seven bands costs an ordinary assessor roughly half a percent of Brier score
 * against their exact number; rounding to three levels costs about twelve
 * percent (Friedman, Baker, Mellers, Tetlock and Zeckhauser, International
 * Studies Quarterly, 2018, over 888,328 forecasts). A high/medium/low scale
 * throws away most of what an assessor knew.
 *
 * THE LADDER. A likelihood may be stated only at moderate confidence or above.
 * Below that the honest answer is a different shape, not a quieter version of
 * the same one: the evidence and agreement terms, what is missing, and what
 * observation would raise confidence. This is enforced by the constructors
 * rather than asked of callers — `assessRisk` refuses a low-confidence
 * likelihood and `unquantifiedRisk` has nowhere to put one, so a judgment
 * carrying a band at low confidence is not a value this module can produce.
 *
 * WHAT THESE JUDGMENTS ARE NOT FOR. Commitment 9 stands: routing and heat read
 * none of this. A band is deliverable content with a stated basis, evaluated
 * by the structural checks below and by whoever reads the finding. Nor are
 * bands multiplied into a score — a likelihood band times an impact band is
 * arithmetic on ordinal labels, and on correlated risks it ranks worse than
 * random (Cox, Risk Analysis, 2008).
 *
 * Whether separating the two statements makes a model's judgments better
 * calibrated is unmeasured. This ships as structural discipline plus a log of
 * what was judged and by when it resolves, so the question becomes answerable;
 * nothing here claims it is already answered.
 */

/** One row of the lexicon: the phrase, and the published range it stands for. */
export interface EstimativeBand {
  readonly word: string;
  /** The range as the lexicon publishes it, inclusive at both ends. */
  readonly low: number;
  readonly high: number;
}

/**
 * The seven bands, in order. The published ranges touch at their endpoints —
 * 45 appears as the top of `unlikely` and the bottom of `roughly even chance`
 * — so `bandFor` resolves a shared endpoint upward, and that rule is the only
 * thing that makes the mapping a function. The ranges are printed as
 * published, because a reader checking the phrase against the standard should
 * find the standard's own numbers.
 */
export const ESTIMATIVE_BANDS: readonly EstimativeBand[] = Object.freeze([
  Object.freeze({ word: 'almost no chance', low: 1, high: 5 }),
  Object.freeze({ word: 'very unlikely', low: 5, high: 20 }),
  Object.freeze({ word: 'unlikely', low: 20, high: 45 }),
  Object.freeze({ word: 'roughly even chance', low: 45, high: 55 }),
  Object.freeze({ word: 'likely', low: 55, high: 80 }),
  Object.freeze({ word: 'very likely', low: 80, high: 95 }),
  Object.freeze({ word: 'almost certain', low: 95, high: 99 }),
]);

/**
 * The band a whole-number percentage falls in.
 *
 * Refuses anything that is not a whole number from 1 to 99. Zero and one
 * hundred are not bands: an assessment that something is impossible or certain
 * is a statement of fact, and dressing it as an estimate hides that nothing
 * about it is being estimated. A fraction is refused because the lexicon has
 * no more resolution than a whole number and rounding one silently would put a
 * precision in the record that the assessor never claimed.
 */
export function bandFor(percent: number): EstimativeBand {
  if (!Number.isInteger(percent)) {
    throw new Error(`bandFor: ${String(percent)} is not a whole-number percentage`);
  }
  if (percent < 1 || percent > 99) {
    throw new Error(
      `bandFor: ${String(percent)} is outside 1–99 — 0 and 100 are statements of fact, not estimates`,
    );
  }
  // Upward at a shared endpoint: the first band whose published top is
  // strictly above the value, and the last band for everything at or above 95.
  return ESTIMATIVE_BANDS.find((band) => percent < band.high) ?? ESTIMATIVE_BANDS[ESTIMATIVE_BANDS.length - 1];
}

/** The band word and its published range, which never travel apart. */
export function renderLikelihood(percent: number): string {
  const band = bandFor(percent);
  return `${band.word} (${String(band.low)}–${String(band.high)}%)`;
}

export const CONFIDENCE_LEVELS = ['high', 'moderate', 'low'] as const;

export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/**
 * The three criteria a confidence level is scored against, named separately
 * because a confidence with no stated basis is an adjective. These are PHIA's
 * yardstick criteria and they are kept as three fields rather than one blob so
 * a reader can see which one is weak: thin information and a volatile subject
 * produce the same word for different reasons and call for different work.
 */
export interface ConfidenceBasis {
  /** How much relevant information there was, and how good it was. */
  readonly informationBase: string;
  /** What method was applied to it, and whether anything checked the method. */
  readonly analyticalRigour: string;
  /** How intricate the subject is and how fast it moves. */
  readonly complexityAndVolatility: string;
}

export interface Confidence {
  readonly level: ConfidenceLevel;
  readonly basis: ConfidenceBasis;
}

/** How robust the evidence is, on the rung below a likelihood. */
export const EVIDENCE_TERMS = ['limited', 'medium', 'robust'] as const;

export type EvidenceTerm = (typeof EVIDENCE_TERMS)[number];

/** How far the available readings agree, on the rung below a likelihood. */
export const AGREEMENT_TERMS = ['low', 'medium', 'high'] as const;

export type AgreementTerm = (typeof AGREEMENT_TERMS)[number];

/**
 * A judgment that carries a likelihood, which it may do only because its
 * confidence is moderate or high.
 *
 * `resolution` and `horizon` are required, not decorative. A likelihood
 * attached to an outcome nobody can observe, by a date nobody named, cannot be
 * scored later, and a band that can never be scored is a mood. `referenceClass`
 * is nullable and its null means "none available" rather than "not asked":
 * stating that no base rate was found is information, and letting the field go
 * missing would make an unanswered question look like an answered one.
 */
export interface AssessedRisk {
  readonly kind: 'assessed';
  /** The outcome being judged, as one falsifiable statement. */
  readonly claim: string;
  /** The assessor's whole-number percentage. The band is derived from it. */
  readonly percent: number;
  readonly confidence: Confidence;
  /** The observation that settles the claim true or false. */
  readonly resolution: string;
  /** The date or event by which it is settled. */
  readonly horizon: string;
  /** The named reference class or base rate with its source, or null. */
  readonly referenceClass: string | null;
  /** What would move the judgment, and in which direction. */
  readonly indicators: readonly string[];
}

/**
 * A judgment whose basis is too thin to carry a likelihood, stating instead
 * what the evidence and the agreement are, what is missing, and what would
 * raise it.
 *
 * The shape of the answer is itself information about the evidence, which is
 * why this is a different type rather than an `AssessedRisk` with an absent
 * band. A reader can tell at a glance that the rung was climbed as far as it
 * goes, and the assessor is not permitted to reach for "roughly even chance"
 * as a way of saying it does not know — a mid-band answer is a claim about the
 * world and owes the same stated basis as any other.
 */
export interface UnquantifiedRisk {
  readonly kind: 'unquantified';
  readonly claim: string;
  readonly confidence: Confidence;
  readonly evidence: EvidenceTerm;
  readonly agreement: AgreementTerm;
  /** The fact that is not in hand. */
  readonly missing: string;
  /** The observation that would raise confidence enough to state a band. */
  readonly raisedBy: string;
}

export type EstimativeJudgment = AssessedRisk | UnquantifiedRisk;

export interface AssessRiskInput {
  readonly claim: string;
  readonly percent: number;
  readonly confidence: Confidence;
  readonly resolution: string;
  readonly horizon: string;
  readonly referenceClass?: string | null;
  readonly indicators?: readonly string[];
}

function required(value: unknown, field: string, fn: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fn}: ${field} is required`);
  }
  return value.trim();
}

function checkedBasis(confidence: Confidence, fn: string): Confidence {
  if (!(CONFIDENCE_LEVELS as readonly string[]).includes(confidence.level)) {
    throw new Error(
      `${fn}: unknown confidence "${String(confidence.level)}" (levels: ${CONFIDENCE_LEVELS.join(', ')})`,
    );
  }
  return {
    level: confidence.level,
    basis: {
      informationBase: required(confidence.basis?.informationBase, 'information base', fn),
      analyticalRigour: required(confidence.basis?.analyticalRigour, 'analytical rigour', fn),
      complexityAndVolatility: required(
        confidence.basis?.complexityAndVolatility,
        'complexity and volatility',
        fn,
      ),
    },
  };
}

/**
 * A likelihood-bearing judgment, or an error.
 *
 * Every rule the ladder states is checked here rather than left to whoever
 * builds one, because a caller that forgot is indistinguishable in the record
 * from a caller that decided. A low-confidence likelihood is refused outright;
 * that case has its own constructor and its own shape.
 */
export function assessRisk(input: AssessRiskInput): AssessedRisk {
  const confidence = checkedBasis(input.confidence, 'assessRisk');
  if (confidence.level === 'low') {
    throw new Error(
      'assessRisk: a likelihood needs moderate confidence or better — state the evidence ' +
        'and agreement terms with unquantifiedRisk instead',
    );
  }
  // Validates the percentage and refuses out of range before anything is built.
  bandFor(input.percent);
  const reference = input.referenceClass?.trim();
  return {
    kind: 'assessed',
    claim: required(input.claim, 'claim', 'assessRisk'),
    percent: input.percent,
    confidence,
    resolution: required(input.resolution, 'resolution', 'assessRisk'),
    horizon: required(input.horizon, 'horizon', 'assessRisk'),
    referenceClass: reference ? reference : null,
    indicators: (input.indicators ?? []).map((i) => i.trim()).filter(Boolean),
  };
}

export interface UnquantifiedRiskInput {
  readonly claim: string;
  readonly confidence: Confidence;
  readonly evidence: EvidenceTerm;
  readonly agreement: AgreementTerm;
  readonly missing: string;
  readonly raisedBy: string;
}

/**
 * The rung below a likelihood, or an error.
 *
 * Refuses a moderate or high confidence: this shape exists because the basis
 * was too thin to state a band, and an assessor with a basis that is not thin
 * owes the band. Refusing here keeps the two rungs from becoming
 * interchangeable, which is the whole content of the ladder.
 */
export function unquantifiedRisk(input: UnquantifiedRiskInput): UnquantifiedRisk {
  const confidence = checkedBasis(input.confidence, 'unquantifiedRisk');
  if (confidence.level !== 'low') {
    throw new Error(
      `unquantifiedRisk: confidence is ${confidence.level} — state the likelihood with assessRisk`,
    );
  }
  if (!(EVIDENCE_TERMS as readonly string[]).includes(input.evidence)) {
    throw new Error(
      `unquantifiedRisk: unknown evidence term "${String(input.evidence)}" (terms: ${EVIDENCE_TERMS.join(', ')})`,
    );
  }
  if (!(AGREEMENT_TERMS as readonly string[]).includes(input.agreement)) {
    throw new Error(
      `unquantifiedRisk: unknown agreement term "${String(input.agreement)}" (terms: ${AGREEMENT_TERMS.join(', ')})`,
    );
  }
  return {
    kind: 'unquantified',
    claim: required(input.claim, 'claim', 'unquantifiedRisk'),
    confidence,
    evidence: input.evidence,
    agreement: input.agreement,
    missing: required(input.missing, 'missing', 'unquantifiedRisk'),
    raisedBy: required(input.raisedBy, 'raisedBy', 'unquantifiedRisk'),
  };
}

/**
 * The confidence statement, always its own sentence and always naming the
 * three criteria it was scored against.
 */
export function renderConfidence(confidence: Confidence): string {
  return (
    `Confidence is ${confidence.level} — information base: ${confidence.basis.informationBase}; ` +
    `analytical rigour: ${confidence.basis.analyticalRigour}; ` +
    `complexity and volatility: ${confidence.basis.complexityAndVolatility}.`
  );
}

/**
 * A judgment as a reader gets it: the likelihood sentence and the confidence
 * sentence separated, with the resolution criterion and horizon that make the
 * band scorable later. The output of this function passes the structural
 * checks below, and a test holds it to that — a renderer that emitted what its
 * own checker rejects would be teaching the shape it forbids.
 */
export function renderJudgment(judgment: EstimativeJudgment): string {
  if (judgment.kind === 'assessed') {
    const parts = [
      `${judgment.claim}: ${renderLikelihood(judgment.percent)}.`,
      renderConfidence(judgment.confidence),
      `Resolves: ${judgment.resolution}.`,
      `Horizon: ${judgment.horizon}.`,
      `Reference class: ${judgment.referenceClass ?? 'none available'}.`,
    ];
    if (judgment.indicators.length > 0) {
      parts.push(`Watch: ${judgment.indicators.join('; ')}.`);
    }
    return parts.join(' ');
  }
  return [
    `${judgment.claim}: no likelihood is stated.`,
    renderConfidence(judgment.confidence),
    `Evidence is ${judgment.evidence} and agreement is ${judgment.agreement}.`,
    `Missing: ${judgment.missing}.`,
    `A likelihood becomes statable on: ${judgment.raisedBy}.`,
  ].join(' ');
}

/**
 * What a role is asked to declare about the stakes on its side.
 *
 * A whole number rather than a phrase, for the reason at the top of this file.
 * The block is refused as a whole when a part is missing, and the assignment
 * says so, because a half-declared judgment reaching a reader as a full one is
 * the failure this shape exists to prevent.
 */
export const ESTIMATIVE_PROTOCOL = [
  'Where your position turns on something that might or might not happen, add',
  'this block, exactly:',
  'STAKES: <the outcome at risk, as one statement that could be shown false>',
  'LIKELIHOOD: <a whole number from 1 to 99, or "none">',
  'CONFIDENCE: high | moderate | low',
  'BASIS: information base: <...>; analytical rigour: <...>; complexity and volatility: <...>',
  'RESOLVES: <the observation that settles STAKES true or false>',
  'HORIZON: <the date or event by which it is settled>',
  'CLASS: <the reference class or base rate you used, with its source — or "none available">',
  'WATCH: <what would move this judgment, and in which direction>',
  '',
  'Give a number only at moderate or high confidence. At low confidence write',
  'LIKELIHOOD: none and add these four lines instead of RESOLVES/HORIZON/CLASS/WATCH:',
  'EVIDENCE: limited | medium | robust',
  'AGREEMENT: low | medium | high',
  'MISSING: <the fact you do not have>',
  'RAISES: <the observation that would let you state a number>',
  '',
  'Never write a likelihood word yourself — the number is what is asked for, and',
  'the word is derived from it. Never put a likelihood and a confidence in one',
  'sentence. A middling number is a claim about the world and needs the same',
  'stated basis as any other; it is not a way of saying you do not know.',
].join('\n');

/**
 * The lexicon as a matcher, longest phrase first so "very unlikely" is one
 * term rather than a nested pair. Word boundaries keep "unlikely" from
 * matching inside itself.
 */
const BAND_WORDS = [...ESTIMATIVE_BANDS]
  .map((band, index) => ({ word: band.word, row: index }))
  .sort((a, b) => b.word.length - a.word.length);

const BAND_MATCHER = new RegExp(`\\b(${BAND_WORDS.map((b) => b.word).join('|')})\\b`, 'gi');

/** A percentage or a percentage range, however the dash was written. */
const PERCENTAGE = /\d{1,3}\s*(?:[–—-]|\bto\b)\s*\d{1,3}\s*%|\d{1,3}\s*%/;

/** A confidence claim, in the words a role writes one in. */
const CONFIDENCE_WORD = /\bconfiden(?:ce|t|tly)\b/i;

/**
 * The band terms that are estimative on their face. "Likely" alone is an
 * ordinary English adverb; "very likely" and the other multi-word terms are
 * the lexicon speaking, whoever typed them, so any one of them engages the
 * checks by itself.
 */
const UNAMBIGUOUS_BAND = new RegExp(
  `\\b(${BAND_WORDS.filter((b) => b.word.includes(' ')).map((b) => b.word).join('|')})\\b`,
  'i',
);

/**
 * A numeric probability claim in prose — "a 55% chance", "probability of
 * 70%" — which is inside the discipline whether or not a lexicon word stands
 * next to it. A number is more precise than a band, not less, but a bare one
 * in prose skips the confidence sentence, the resolution, and the horizon,
 * which is the whole of what the form carries.
 */
const PROBABILITY_CLAIM =
  /\b\d{1,3}(?:\.\d+)?\s*%\s*(?:chance|probability|likelihood|odds)\b|\b(?:chance|probability|likelihood|odds)\b[^.!?%]{0,40}?\b\d{1,3}(?:\.\d+)?\s*%/i;

/** A declared likelihood line carrying a number, however the model decorated it. */
const DECLARED_LIKELIHOOD = /^\s*likelihood\s*[:\-–]\s*(\d{1,3})\s*%?\s*$/i;

const RESOLUTION_MARKER = /\bresolv(?:es|ed|ution)\b|\bsettled by\b|\bresolution criterion\b/i;

const HORIZON_MARKER =
  /\bhorizon\b|\bby (?:the )?end of\b|\bby \d{4}-\d{2}-\d{2}\b|\bwithin \d+\b|\b(?:next|in) \d+ (?:days?|weeks?|months?|quarters?|years?)\b/i;

/** Markdown decoration removed so a label reads the same however it was written. */
function undecorated(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/[*_`>#]/g, '').replace(/^\s*[-+•]\s*/, '').trim())
    .filter(Boolean);
}

/** Lines split further at sentence ends, which is the unit two of the checks work in. */
function sentences(lines: readonly string[]): string[] {
  return lines.flatMap((line) => line.split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter(Boolean);
}

function bandRowsIn(text: string): number[] {
  const rows = new Set<number>();
  for (const match of text.matchAll(BAND_MATCHER)) {
    const found = BAND_WORDS.find((b) => b.word === match[1].toLowerCase());
    if (found) rows.add(found.row);
  }
  return [...rows];
}

/**
 * Whether this deliverable speaks the lexicon formally at all: a declared
 * likelihood line, or a band word standing next to a percentage.
 *
 * The gate matters as much as the checks. "Likely" is an ordinary English
 * adverb and a checker that graded every occurrence of it would fail honest
 * prose for a word nobody meant estimatively — a bare single-word "likely" or
 * "unlikely" with no number anywhere is the one shape that stays ungraded,
 * and that line is deliberate. Everything estimative on its face engages the
 * checks by itself: a declared likelihood line, a band word beside a
 * percentage, a multi-word lexicon term, and a numeric probability claim in
 * prose. Once any of those appears, every use of the lexicon in the
 * deliverable is a use of the lexicon, and the checks apply to all of them.
 */
function declaresEstimative(lines: readonly string[]): boolean {
  if (lines.some((line) => DECLARED_LIKELIHOOD.test(line))) return true;
  return sentences(lines).some(
    (s) =>
      (bandRowsIn(s).length > 0 && PERCENTAGE.test(s)) ||
      UNAMBIGUOUS_BAND.test(s) ||
      PROBABILITY_CLAIM.test(s),
  );
}

/**
 * Everything wrong with the estimative language in a deliverable, in the words
 * the role needs to fix it. Empty when there is nothing to say, which includes
 * the common case of a deliverable that makes no estimative claim.
 *
 * These answer "was this stated in the form that can be checked later", never
 * "is the number any good". Whether 60 was the right number is the substantive
 * question, and the log of judgments and their resolutions is what will
 * eventually answer it.
 */
export function estimativeProblems(deliverable: string): string[] {
  const lines = undecorated(deliverable);
  if (!declaresEstimative(lines)) return [];

  const problems: string[] = [];
  for (const sentence of sentences(lines)) {
    const rows = bandRowsIn(sentence);
    if (rows.length === 0 && PROBABILITY_CLAIM.test(sentence)) {
      problems.push(
        `a numeric probability stands outside the lexicon: "${sentence}" — state it as its ` +
          'band word with its range, so the claim and its checkable form are the same sentence',
      );
      continue;
    }
    if (rows.length === 0) continue;
    if (rows.length > 1) {
      problems.push(
        `one claim uses terms from ${String(rows.length)} rows of the lexicon: "${sentence}" — ` +
          'a claim sits in exactly one band',
      );
    }
    if (!PERCENTAGE.test(sentence)) {
      problems.push(
        `a likelihood word carries no numeric range: "${sentence}" — readers pull a bare ` +
          'estimative word toward even odds, so the range travels with it',
      );
    }
    if (CONFIDENCE_WORD.test(sentence)) {
      problems.push(
        `likelihood and confidence share a sentence: "${sentence}" — the first is about the ` +
          'world and the second is about the basis, and a reader cannot tell which is hedged',
      );
    }
  }

  const whole = lines.join('\n');
  if (!RESOLUTION_MARKER.test(whole)) {
    problems.push(
      'a likelihood is stated with no resolution criterion — name the observation that settles it',
    );
  }
  if (!HORIZON_MARKER.test(whole)) {
    problems.push('a likelihood is stated with no horizon — name the date or event by which it settles');
  }
  return problems;
}
