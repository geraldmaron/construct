/**
 * tests/kernel/metrics/intervals.test.ts — construct-2jb.1.
 *
 * Every expected value here is either a published reference figure or a closed
 * form that can be evaluated by hand, never this module's own output captured as
 * a golden. That distinction is the whole point: a statistics module checked
 * against itself would agree with itself while being wrong, and the defect this
 * module exists to fix is precisely a number nobody checked.
 *
 * The closed forms used below, so a reader can re-derive rather than trust:
 *
 *   - Clopper-Pearson, k = n: the lower limit is alpha^(1/n), for whichever
 *     alpha the sidedness implies. Two-sided 95% at 5/5 is 0.025^(1/5); one-sided
 *     95% is 0.05^(1/5).
 *   - Clopper-Pearson, k = 0: the upper limit is 1 - alpha^(1/n).
 *   - McNemar with b discordant pairs all one way: 2 * (1/2)^b.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  binomialCdf,
  clopperPearson,
  clopperPearsonLowerBound,
  formatRate,
  mcnemarExact,
  probit,
  requiredTrials,
  wilson,
} from '../../../src/kernel/metrics/intervals.ts';

/** Tight enough to catch a wrong method, loose enough to survive bisection. */
function near(actual: number, expected: number, tolerance = 1e-6): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, got ${actual} (tolerance ${tolerance})`,
  );
}

test('probit reproduces the standard normal quantiles every table lists', () => {
  near(probit(0.975), 1.959964, 1e-5);
  near(probit(0.95), 1.644854, 1e-5);
  near(probit(0.8), 0.8416212, 1e-5);
  near(probit(0.5), 0, 1e-9);
  near(probit(0.025), -1.959964, 1e-5);
});

test('the binomial CDF matches values computable by hand', () => {
  // P(X = 0) for ten fair coins is 1/1024.
  near(binomialCdf(0, 10, 0.5), 1 / 1024, 1e-12);
  // Symmetry of the fair binomial: P(X <= 5) for n = 10 is 1/2 plus half the
  // central term, so P(X <= 4) + P(X <= 5) = 1.
  near(binomialCdf(4, 10, 0.5) + binomialCdf(5, 10, 0.5), 1, 1e-12);
  near(binomialCdf(10, 10, 0.5), 1, 1e-12);
  // A large n exercises the log-space path and the shorter-tail branch, where a
  // naive C(1000,500) would overflow to Infinity. Symmetry of the fair binomial
  // gives P(X <= 499) + P(X <= 500) = 1 exactly.
  near(binomialCdf(499, 1000, 0.5) + binomialCdf(500, 1000, 0.5), 1, 1e-9);
});

test('the Wilson interval on the fresh corpus is the finding that motivated this module', () => {
  // Three misses out of ten expected labels.
  const ci = wilson(3, 10);
  near(ci.low, 0.10779, 1e-4);
  near(ci.high, 0.60323, 1e-4);
  assert.ok(
    ci.low < 0.15 && ci.high > 0.15,
    'the 0.15 target must fall inside the interval — that is why 0.300 does not refute it',
  );
});

test('Wilson stays informative where the normal approximation collapses', () => {
  // Escalation fired on none of the twenty-four held-out outcomes. The normal
  // approximation gives [0, 0] here, which would license "escalation never
  // fires" from twenty-four observations.
  const ci = wilson(0, 24);
  near(ci.low, 0, 1e-12);
  near(ci.high, 0.13798, 1e-4);
  assert.ok(ci.high > 0, 'a rate of zero does not mean the true rate is zero');
});

test('Wilson never leaves the unit interval', () => {
  for (const [k, n] of [[0, 1], [1, 1], [0, 3], [3, 3], [1, 2]] as const) {
    const ci = wilson(k, n);
    assert.ok(ci.low >= 0 && ci.high <= 1, `wilson(${k},${n}) escaped [0,1]`);
    assert.ok(ci.low <= ci.high);
  }
});

test('no observations is total ignorance, not certainty', () => {
  assert.deepEqual(wilson(0, 0), { low: 0, high: 1 });
  assert.deepEqual(clopperPearson(0, 0), { low: 0, high: 1 });
});

test('Clopper-Pearson at 5/5 matches its closed form, and the phase-5 gate with it', () => {
  const ci = clopperPearson(5, 5);
  // Two-sided 95%: alpha/2 = 0.025, lower limit = 0.025^(1/5).
  near(ci.low, Math.pow(0.025, 1 / 5), 1e-9);
  near(ci.low, 0.478, 1e-3);
  assert.equal(ci.high, 1);
});

test('the one-sided lower bound is a different number from the two-sided lower limit', () => {
  // 0.05^(1/5) vs 0.025^(1/5). Conflating them is an easy way to overstate a
  // gate by seven points of success rate.
  near(clopperPearsonLowerBound(5, 5), Math.pow(0.05, 1 / 5), 1e-9);
  near(clopperPearsonLowerBound(5, 5), 0.549, 1e-3);
  assert.ok(clopperPearsonLowerBound(5, 5) > clopperPearson(5, 5).low);
});

test('Clopper-Pearson at 0/24 matches its closed form', () => {
  const ci = clopperPearson(0, 24);
  assert.equal(ci.low, 0);
  near(ci.high, 1 - Math.pow(0.025, 1 / 24), 1e-9);
  near(ci.high, 0.14247, 1e-4);
});

test('Clopper-Pearson is the conservative one, as its purpose requires', () => {
  // Exact coverage is at least nominal, so its interval contains Wilson's.
  for (const [k, n] of [[3, 10], [12, 40], [1, 24]] as const) {
    const exact = clopperPearson(k, n);
    const score = wilson(k, n);
    assert.ok(
      exact.low <= score.low + 1e-9 && exact.high >= score.high - 1e-9,
      `clopper-pearson(${k},${n}) should not be tighter than wilson`,
    );
  }
});

test('one discordant pair is no evidence at all', () => {
  // The fresh corpus went 0.400 -> 0.300 with escalation: a single outcome
  // changing state. Reported as an improvement, it was a coin landing once.
  assert.equal(mcnemarExact(1, 0), 1);
  assert.equal(mcnemarExact(0, 1), 1);
});

test('McNemar matches the closed form as the discordant pairs pile up', () => {
  near(mcnemarExact(10, 0), 2 * Math.pow(0.5, 10), 1e-12);
  near(mcnemarExact(0, 5), 2 * Math.pow(0.5, 5), 1e-12);
  // Balanced disagreement is maximally uninformative regardless of volume.
  assert.equal(mcnemarExact(50, 50), 1);
});

test('agreement is not evidence of sameness', () => {
  assert.equal(mcnemarExact(0, 0), 1);
});

test('McNemar is symmetric, because a two-sided test has no favoured direction', () => {
  near(mcnemarExact(9, 2), mcnemarExact(2, 9), 1e-12);
});

test('sizing says how far short the corpus falls', () => {
  // Distinguishing a 0.15 miss rate from 0.30 at 80% power, two-sided 5%.
  // (1.959964*sqrt(.21) + 0.841621*sqrt(.1275))^2 / 0.15^2 = 63.86 -> 64.
  assert.equal(requiredTrials({ baseline: 0.3, target: 0.15 }), 64);
  // The finer question the project will eventually want to ask.
  assert.ok(requiredTrials({ baseline: 0.2, target: 0.15 }) > 400);
  // More power costs more labels; a smaller effect costs far more.
  assert.ok(
    requiredTrials({ baseline: 0.3, target: 0.15, power: 0.95 }) >
      requiredTrials({ baseline: 0.3, target: 0.15, power: 0.8 }),
  );
  assert.equal(requiredTrials({ baseline: 0.2, target: 0.2 }), Infinity);
});

test('formatRate never prints a rate without its width', () => {
  const line = formatRate(3, 10);
  assert.match(line, /^0\.300 \(3\/10, 95% CI \[0\.10[0-9], 0\.60[0-9]\]\)$/);
  assert.equal(formatRate(0, 0), 'n/a (0 observations)');
});

test('impossible counts are rejected rather than silently coerced', () => {
  assert.throws(() => wilson(11, 10), RangeError);
  assert.throws(() => wilson(-1, 10), RangeError);
  assert.throws(() => wilson(1.5, 10), RangeError);
  assert.throws(() => probit(0), RangeError);
  assert.throws(() => probit(1), RangeError);
  assert.throws(() => mcnemarExact(-1, 0), RangeError);
});
