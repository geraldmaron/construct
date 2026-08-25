/**
 * tests/kernel/run/estimative.test.ts — a likelihood and a confidence are two
 * statements, and the code will not let them become one.
 *
 * Three properties carry the whole design and each is held here rather than
 * described in a comment: the band is arithmetic over an integer and refuses
 * anything that is not one, a likelihood cannot exist at low confidence
 * because the type that carries one cannot be built there, and the structural
 * checks fail each of the four shapes the standards forbid.
 *
 * The renderer is held to its own checker, which is the property that keeps the
 * two halves honest: a renderer emitting what its checker rejects would be
 * teaching every reader the shape the checker exists to refuse.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTIMATIVE_BANDS,
  ESTIMATIVE_PROTOCOL,
  assessRisk,
  bandFor,
  estimativeProblems,
  renderConfidence,
  renderJudgment,
  renderLikelihood,
  unquantifiedRisk,
} from '../../../src/kernel/run/estimative.ts';
import type { Confidence } from '../../../src/kernel/run/estimative.ts';

const MODERATE: Confidence = {
  level: 'moderate',
  basis: {
    informationBase: 'two prior migrations of this table are logged',
    analyticalRigour: 'one pass, nothing checked it',
    complexityAndVolatility: 'the schema is still moving weekly',
  },
};

const LOW: Confidence = {
  level: 'low',
  basis: {
    informationBase: 'no comparable migration is on record',
    analyticalRigour: 'a single reading, unchecked',
    complexityAndVolatility: 'the vendor changes the interface without notice',
  },
};

function assessed() {
  return assessRisk({
    claim: 'the cutover loses rows',
    percent: 60,
    confidence: MODERATE,
    resolution: 'the row counts on both sides of the first production cutover',
    horizon: 'within 30 days',
    referenceClass: 'the two logged migrations of this table',
    indicators: ['a third schema change before cutover moves this up'],
  });
}

test('the seven bands are the lexicon, and a shared endpoint resolves upward', () => {
  assert.equal(ESTIMATIVE_BANDS.length, 7);
  assert.deepEqual(
    ESTIMATIVE_BANDS.map((band) => band.word),
    [
      'almost no chance',
      'very unlikely',
      'unlikely',
      'roughly even chance',
      'likely',
      'very likely',
      'almost certain',
    ],
  );

  // Inside each band, and then on every endpoint the published ranges share.
  assert.equal(bandFor(1).word, 'almost no chance');
  assert.equal(bandFor(4).word, 'almost no chance');
  assert.equal(bandFor(5).word, 'very unlikely');
  assert.equal(bandFor(20).word, 'unlikely');
  assert.equal(bandFor(45).word, 'roughly even chance');
  assert.equal(bandFor(55).word, 'likely');
  assert.equal(bandFor(80).word, 'very likely');
  assert.equal(bandFor(95).word, 'almost certain');
  assert.equal(bandFor(99).word, 'almost certain');
});

test('0, 100, and a fraction are refused rather than rounded into a band', () => {
  assert.throws(() => bandFor(0), /statements of fact/);
  assert.throws(() => bandFor(100), /statements of fact/);
  assert.throws(() => bandFor(-3), /outside 1–99/);
  assert.throws(() => bandFor(60.5), /not a whole-number percentage/);
  assert.throws(() => bandFor(Number.NaN), /not a whole-number percentage/);
});

test('the word never travels without its range', () => {
  assert.equal(renderLikelihood(60), 'likely (55–80%)');
  assert.equal(renderLikelihood(3), 'almost no chance (1–5%)');
  assert.equal(renderLikelihood(97), 'almost certain (95–99%)');
});

test('a likelihood cannot be built at low confidence, and the rung below cannot be built above it', () => {
  assert.throws(
    () => assessRisk({ ...assessed(), confidence: LOW }),
    /moderate confidence or better/,
  );
  assert.throws(
    () =>
      unquantifiedRisk({
        claim: 'the vendor deprecates the endpoint',
        confidence: MODERATE,
        evidence: 'limited',
        agreement: 'low',
        missing: 'the vendor has published no deprecation policy',
        raisedBy: 'a written deprecation policy, or one prior deprecation on record',
      }),
    /state the likelihood with assessRisk/,
  );
});

test('a likelihood with no resolution criterion or horizon is refused at construction', () => {
  assert.throws(() => assessRisk({ ...assessed(), resolution: '   ' }), /resolution is required/);
  assert.throws(() => assessRisk({ ...assessed(), horizon: '' }), /horizon is required/);
});

test('a confidence is scored against three named criteria or it is not a confidence', () => {
  assert.throws(
    () =>
      assessRisk({
        ...assessed(),
        confidence: { level: 'moderate', basis: { ...MODERATE.basis, analyticalRigour: '' } },
      }),
    /analytical rigour is required/,
  );
  const rendered = renderConfidence(MODERATE);
  assert.match(rendered, /^Confidence is moderate/);
  assert.match(rendered, /information base:/);
  assert.match(rendered, /analytical rigour:/);
  assert.match(rendered, /complexity and volatility:/);
});

test('an absent reference class reads as none available rather than as unasked', () => {
  const judgment = assessRisk({ ...assessed(), referenceClass: null });
  assert.equal(judgment.referenceClass, null);
  assert.match(renderJudgment(judgment), /Reference class: none available\./);
});

test('the rung below states what is missing and what would raise it, and no band', () => {
  const rendered = renderJudgment(
    unquantifiedRisk({
      claim: 'the vendor deprecates the endpoint',
      confidence: LOW,
      evidence: 'limited',
      agreement: 'low',
      missing: 'the vendor has published no deprecation policy',
      raisedBy: 'a written deprecation policy, or one prior deprecation on record',
    }),
  );
  assert.match(rendered, /no likelihood is stated/);
  assert.match(rendered, /Confidence is low —/);
  assert.match(rendered, /Evidence is limited and agreement is low\./);
  assert.match(rendered, /Missing: the vendor has published no deprecation policy\./);
  assert.match(rendered, /A likelihood becomes statable on:/);
  assert.doesNotMatch(rendered, /\d+–\d+%/);
});

test('what the renderer emits passes the checks the renderer ships with', () => {
  assert.deepEqual(estimativeProblems(renderJudgment(assessed())), []);
  assert.deepEqual(
    estimativeProblems(
      renderJudgment(
        unquantifiedRisk({
          claim: 'the vendor deprecates the endpoint',
          confidence: LOW,
          evidence: 'limited',
          agreement: 'low',
          missing: 'no published policy',
          raisedBy: 'a published policy',
        }),
      ),
    ),
    [],
  );
});

test('prose that never speaks the lexicon formally is not graded on it', () => {
  // "Likely" is an ordinary adverb, and a checker that failed every use of it
  // would fail honest work for a word nobody meant estimatively.
  assert.deepEqual(
    estimativeProblems('This will likely need a second pass before anyone signs it off.'),
    [],
  );
});

test('a likelihood word with no numeric range beside it fails', () => {
  const problems = estimativeProblems(
    [
      'LIKELIHOOD: 60',
      'The cutover is likely to lose rows.',
      'Resolves: the row counts on both sides. Horizon: within 30 days.',
    ].join('\n'),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /carries no numeric range/);
});

test('a likelihood and a confidence in one sentence fails', () => {
  const problems = estimativeProblems(
    [
      'We are moderately confident the cutover is likely (55–80%) to lose rows.',
      'Resolves: the row counts on both sides. Horizon: within 30 days.',
    ].join('\n'),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /likelihood and confidence share a sentence/);
});

test('terms from more than one row of the lexicon in one claim fails', () => {
  const problems = estimativeProblems(
    [
      'The cutover is unlikely to very likely (20–45%) to lose rows.',
      'Resolves: the row counts on both sides. Horizon: within 30 days.',
    ].join('\n'),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /terms from 2 rows of the lexicon/);
});

test('a likelihood with no resolution criterion and no horizon fails on both', () => {
  const problems = estimativeProblems('The cutover is likely (55–80%) to lose rows.');
  assert.equal(problems.length, 2);
  assert.match(problems[0], /no resolution criterion/);
  assert.match(problems[1], /no horizon/);
});

test('the protocol asks for a number and forbids the role picking the word', () => {
  assert.match(ESTIMATIVE_PROTOCOL, /LIKELIHOOD: <a whole number from 1 to 99, or "none">/);
  assert.match(ESTIMATIVE_PROTOCOL, /CONFIDENCE: high \| moderate \| low/);
  assert.match(ESTIMATIVE_PROTOCOL, /information base: <\.\.\.>; analytical rigour:/);
  assert.match(ESTIMATIVE_PROTOCOL, /Never write a likelihood word yourself/);
  assert.match(ESTIMATIVE_PROTOCOL, /Never put a likelihood and a confidence in one/);
  assert.match(ESTIMATIVE_PROTOCOL, /Give a number only at moderate or high confidence/);
});

test('a multi-word lexicon term engages the checks by itself, with no number anywhere', () => {
  const problems = estimativeProblems(
    'The rollout is very likely to succeed. Nothing else here speaks estimatively.',
  );
  assert.ok(problems.some((p) => p.includes('carries no numeric range')));
  assert.ok(problems.some((p) => p.includes('no resolution criterion')));
});

test('a numeric probability in prose is inside the discipline without a lexicon word', () => {
  const problems = estimativeProblems(
    "There's about a 55% chance the migration completes by end of quarter.",
  );
  assert.ok(problems.some((p) => p.includes('outside the lexicon')));
});

test('a bare single-word adverb with no number anywhere stays ungraded, deliberately', () => {
  assert.deepEqual(
    estimativeProblems('The rollout is likely to succeed given current signals.'),
    [],
  );
});
