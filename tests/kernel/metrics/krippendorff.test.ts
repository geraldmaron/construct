/**
 * tests/kernel/metrics/krippendorff.test.ts — validates the alpha
 * implementation against published worked examples, not against numbers this
 * project made up (construct-2jb.3). No fixture here is model- or
 * project-authored; both come from citable published sources, matched to the
 * digit the source reports.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  krippendorffAlpha,
  masiDistance,
  nominalSetDistance,
} from '../../../src/kernel/metrics/krippendorff.ts';
import type { Observation } from '../../../src/kernel/metrics/krippendorff.ts';

/**
 * Source: "Krippendorff's alpha", Wikipedia, worked example section (accessed
 * 2026-08-04), itself a reproduction of the standard nominal worked example
 * used in Krippendorff's "Content Analysis: An Introduction to Its
 * Methodology" and in Hayes & Krippendorff (2007), "Answering the Call for a
 * Standard Reliability Measure for Coding Data", Communication Methods and
 * Measures 1(1), 77-89.
 *
 * Three coders (A, B, C) code 15 units on a single nominal category each;
 * `null` marks a unit a coder did not code. The published result: n = 26
 * pairable values across 12 multiply-coded units, alpha_nominal = 0.691.
 */
const WIKIPEDIA_NOMINAL: {
  readonly coder: string;
  readonly values: readonly (string | null)[];
}[] = [
  { coder: 'A', values: [null, null, null, null, null, '3', '4', '1', '2', '1', '1', '3', '3', null, '3'] },
  { coder: 'B', values: ['1', null, '2', '1', '3', '3', '4', '3', null, null, null, null, null, null, null] },
  { coder: 'C', values: [null, null, '2', '1', '3', '4', '4', null, '2', '1', '1', '3', '3', null, '4'] },
];

function wikipediaObservations(): Observation[] {
  const obs: Observation[] = [];
  for (const { coder, values } of WIKIPEDIA_NOMINAL) {
    values.forEach((value, i) => {
      if (value === null) return;
      obs.push({ unit: String(i + 1), coder, value: new Set([value]) });
    });
  }
  return obs;
}

test('krippendorffAlpha reproduces the published nominal worked example (Wikipedia / Hayes & Krippendorff 2007)', () => {
  const result = krippendorffAlpha(wikipediaObservations(), nominalSetDistance);
  assert.equal(result.n, 26);
  assert.equal(result.unitsUsed, 12);
  assert.ok(
    Math.abs(result.alpha - 0.691) < 0.001,
    `expected alpha ~= 0.691, got ${result.alpha}`,
  );
});

/**
 * Source: gdmcdonald, "Multi-Label Agreement" (GitHub Pages, R/Quarto),
 * https://gdmcdonald.github.io/multi-label-inter-rater-agreement/Multi-Label_Agreement.html
 * (accessed 2026-08-04). Worked example of Krippendorff's alpha computed with
 * the MASI distance (Passonneau 2006) over set-valued (multi-label) codes: 11
 * units, 3 coders, one missing cell. Published result: alpha = 0.40257 (95%
 * CI [0.064, 0.741] via bootstrap, not reproduced here — only the point
 * estimate is a closed-form check).
 */
const MASI_EXAMPLE: Record<string, Record<string, readonly string[] | null>> = {
  '1': { c1: ['l1', 'l2'], c2: ['l1'], c3: ['l2'] },
  '2': { c1: ['l1', 'l2'], c2: ['l1', 'l2'], c3: ['l1', 'l2'] },
  '3': { c1: ['l1'], c2: ['l1'], c3: ['l1'] },
  '4': { c1: ['l3'], c2: ['l3'], c3: null },
  '5': { c1: ['l3'], c2: ['l1', 'l3'], c3: ['l1', 'l3'] },
  '6': { c1: ['l4'], c2: ['l4'], c3: ['l4'] },
  '7': { c1: ['l2'], c2: ['l4'], c3: ['l5'] },
  '8': { c1: ['l1', 'l2'], c2: ['l1'], c3: ['l2'] },
  '9': { c1: ['l1', 'l2'], c2: ['l1', 'l2', 'l3'], c3: ['l1', 'l2', 'l3', 'l9'] },
  '10': { c1: ['l1'], c2: ['l2', 'l4'], c3: ['l1'] },
  '11': { c1: ['l1'], c2: ['l1'], c3: ['l5'] },
};

function masiObservations(): Observation[] {
  const obs: Observation[] = [];
  for (const [unit, coders] of Object.entries(MASI_EXAMPLE)) {
    for (const [coder, values] of Object.entries(coders)) {
      if (values === null) continue;
      obs.push({ unit, coder, value: new Set(values) });
    }
  }
  return obs;
}

test('krippendorffAlpha reproduces the published MASI multi-label worked example (gdmcdonald)', () => {
  const result = krippendorffAlpha(masiObservations(), masiDistance);
  assert.equal(result.n, 32);
  assert.equal(result.unitsUsed, 11);
  assert.ok(
    Math.abs(result.alpha - 0.40257) < 0.0005,
    `expected alpha ~= 0.40257, got ${result.alpha}`,
  );
});

test('nominalSetDistance is 0 for identical sets and 1 for any difference', () => {
  assert.equal(nominalSetDistance(new Set(['a']), new Set(['a'])), 0);
  assert.equal(nominalSetDistance(new Set(['a']), new Set(['b'])), 1);
  assert.equal(nominalSetDistance(new Set(['a', 'b']), new Set(['a'])), 1);
});

test('masiDistance is 0 for identical sets and 1 for disjoint sets', () => {
  assert.equal(masiDistance(new Set(['a', 'b']), new Set(['a', 'b'])), 0);
  assert.equal(masiDistance(new Set(['a']), new Set(['b'])), 1);
});

test('a singly-coded unit is dropped from n, not padded with a fabricated second value', () => {
  const obs: Observation[] = [
    { unit: 'u1', coder: 'a', value: new Set(['x']) },
    { unit: 'u1', coder: 'b', value: new Set(['x']) },
    { unit: 'u2', coder: 'a', value: new Set(['y']) }, // only one coder on u2
  ];
  const result = krippendorffAlpha(obs, nominalSetDistance);
  assert.equal(result.unitsTotal, 2);
  assert.equal(result.unitsUsed, 1);
  assert.equal(result.n, 2);
});

test('alpha is NaN, not 1, when there is no variance in the pool to measure reliability against', () => {
  const obs: Observation[] = [
    { unit: 'u1', coder: 'a', value: new Set(['x']) },
    { unit: 'u1', coder: 'b', value: new Set(['x']) },
    { unit: 'u2', coder: 'a', value: new Set(['x']) },
    { unit: 'u2', coder: 'b', value: new Set(['x']) },
  ];
  const result = krippendorffAlpha(obs, nominalSetDistance);
  assert.ok(Number.isNaN(result.alpha));
  assert.equal(result.Do, 0);
  assert.equal(result.De, 0);
});
