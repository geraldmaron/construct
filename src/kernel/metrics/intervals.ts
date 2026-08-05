/**
 * kernel/metrics/intervals.ts — how uncertain is a rate this project quotes?
 *
 *
 * The project measures its corpora honestly and then reasons about the results
 * as if they were precise. Those are different failures and only the first one
 * was solved. A miss rate of 0.300 on the fresh corpus is three misses out of
 * ten, and three-out-of-ten is consistent with a true rate anywhere from about
 * 0.11 to about 0.60. Reported as "0.300 against a 0.15 target", it reads as a
 * missed target; reported with its interval, it is a measurement that cannot
 * distinguish the two hypotheses at all. Commitment 15 forbids the confident
 * wrong answer, and a point estimate quoted without its width is exactly that
 * shape applied to the system's own metrics.
 *
 * So: every rate this project quotes gets an interval, and the interval comes
 * from here rather than from each caller re-deriving it. Three instruments,
 * each chosen for a reason the corpora force:
 *
 *   - Wilson, not the textbook normal approximation. At n = 10 the normal
 *     approximation is simply invalid, and at a rate of 0 (the escalation
 *     frequency, measured 0/24) it produces the degenerate interval [0, 0],
 *     which would license the claim that escalation *never* fires from
 *     twenty-four observations. Wilson stays inside [0, 1] and stays honest at
 *     the boundary.
 *   - Clopper-Pearson for the phase gates, which live entirely at the boundary.
 *     "Five external users each succeed" is 5/5, where only an exact method
 *     says anything defensible.
 *   - McNemar for before/after. The project's characteristic comparison is
 *     paired — the same corpus, scored before and after a catalog change — and
 *     comparing two independent-looking point estimates both overstates the
 *     evidence and ignores that the pairing is the strongest thing about the
 *     design.
 *
 * No dependencies, in keeping with the kernel: the binomial CDF is summed in
 * log space and the bounds are found by bisection, which is slower than a
 * special-function library and accurate to far more digits than a corpus of 85
 * labels could ever justify.
 */

/** A two-sided confidence interval on a proportion. */
export interface Interval {
  readonly low: number;
  readonly high: number;
}

/** Bisection tolerance. Far finer than any corpus here can justify. */
const TOLERANCE = 1e-12;
const MAX_ITERATIONS = 200;

/**
 * Lanczos approximation to ln Γ(x), for x > 0. Used only to reach ln C(n, k)
 * without overflowing: C(1000, 500) has no double representation, its logarithm
 * is unremarkable.
 */
const LANCZOS: readonly number[] = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

function lnGamma(x: number): number {
  if (x < 0.5) {
    // Reflection, so the series below is only ever evaluated where it converges.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }
  const z = x - 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < LANCZOS.length; i += 1) a += LANCZOS[i]! / (z + i + 1);
  const t = z + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

function lnChoose(n: number, k: number): number {
  return lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1);
}

/**
 * P(X <= k) for X ~ Binomial(n, p), summed in log space.
 *
 * Summed from whichever tail is shorter, so the returned value never depends on
 * accumulating a long run of negligible terms.
 */
export function binomialCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return 0;

  const lnP = Math.log(p);
  const lnQ = Math.log1p(-p);
  const term = (i: number): number => Math.exp(lnChoose(n, i) + i * lnP + (n - i) * lnQ);

  // Sum the shorter tail. Summing k+1 terms when k is near n wastes precision on
  // the many negligible ones and loses the significant few to rounding.
  if (k < n - k) {
    let sum = 0;
    for (let i = 0; i <= k; i += 1) sum += term(i);
    return Math.min(1, sum);
  }
  let upper = 0;
  for (let i = k + 1; i <= n; i += 1) upper += term(i);
  return Math.max(0, 1 - upper);
}

/**
 * The standard normal quantile (probit), by Acklam's rational approximation
 * refined with one Halley step. Accurate to roughly machine precision, which is
 * gratuitous here and cheap.
 */
export function probit(p: number): number {
  if (p <= 0 || p >= 1) throw new RangeError(`probit requires 0 < p < 1, got ${p}`);

  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416];

  const plow = 0.02425;
  let x: number;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p <= 1 - plow) {
    const q = p - 0.5;
    const r = q * q;
    x = (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log1p(-p));
    x = -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }

  // One Halley refinement against the erfc-based CDF.
  const e = 0.5 * erfc(-x / Math.SQRT2) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/** Complementary error function, Numerical Recipes' Chebyshev form. */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 2 / (2 + z);
  const ty = 4 * t - 2;
  const cof = [-1.3026537197817094, 6.4196979235649026e-1, 1.9476473204185836e-2,
    -9.561514786808631e-3, -9.46595344482036e-4, 3.66839497852761e-4,
    4.2523324806907e-5, -2.0278578112534e-5, -1.624290004647e-6,
    1.303655835580e-6, 1.5626441722e-8, -8.5238095915e-8, 6.529054439e-9,
    5.059343495e-9, -9.91364156e-10, -2.27365122e-10, 9.6467911e-11,
    2.394038e-12, -6.886027e-12, 8.94487e-13, 3.13092e-13, -1.12708e-13,
    3.81e-16, 7.106e-15];
  let dd = 0;
  let dv = 0;
  for (let j = cof.length - 1; j > 0; j -= 1) {
    const tmp = dv;
    dv = ty * dv - dd + cof[j]!;
    dd = tmp;
  }
  const ans = t * Math.exp(-z * z + 0.5 * (cof[0]! + ty * dv) - dd);
  return x >= 0 ? ans : 2 - ans;
}

function checkCount(successes: number, trials: number): void {
  if (!Number.isInteger(successes) || !Number.isInteger(trials)) {
    throw new RangeError('successes and trials must be integers');
  }
  if (trials < 0 || successes < 0 || successes > trials) {
    throw new RangeError(`invalid count: ${successes} of ${trials}`);
  }
}

/**
 * The Wilson score interval on a proportion.
 *
 * The default reporting instrument for every rate in this project. It is the
 * interval that stays inside [0, 1], stays informative at 0 and at 1, and does
 * not require the large-n assumption that none of these corpora satisfy.
 *
 * Worked: wilson(3, 10) is approximately [0.108, 0.603]. That interval contains
 * both the fresh corpus's measured 0.300 and the project's 0.15 target, which is
 * the finding that motivated this module.
 */
export function wilson(successes: number, trials: number, confidence = 0.95): Interval {
  checkCount(successes, trials);
  if (trials === 0) return { low: 0, high: 1 };

  const z = probit(1 - (1 - confidence) / 2);
  const phat = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (phat + z2 / (2 * trials)) / denominator;
  const spread =
    (z / denominator) *
    Math.sqrt((phat * (1 - phat)) / trials + z2 / (4 * trials * trials));
  return { low: Math.max(0, center - spread), high: Math.min(1, center + spread) };
}

/**
 * Solve `predicate(p)` from increasing to decreasing (or the reverse) by
 * bisection on [0, 1]. Every bound below is a monotone root-find in p.
 */
function bisect(f: (p: number) => number, target: number, increasing: boolean): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < MAX_ITERATIONS && hi - lo > TOLERANCE; i += 1) {
    const mid = (lo + hi) / 2;
    const above = increasing ? f(mid) > target : f(mid) < target;
    if (above) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The Clopper-Pearson ("exact") interval.
 *
 * Reserved for the boundary cases, which is where the phase gates live. It is
 * conservative — its coverage is at least the stated confidence rather than
 * approximately it — and that is the right bias for a gate that decides whether
 * a product ships.
 *
 * Worked: clopperPearson(5, 5) is approximately [0.478, 1.000]. Five successes
 * out of five, read as a two-sided 95% interval, licenses only the claim that
 * the true success rate exceeds about 0.48.
 */
export function clopperPearson(successes: number, trials: number, confidence = 0.95): Interval {
  checkCount(successes, trials);
  if (trials === 0) return { low: 0, high: 1 };
  const alpha = 1 - confidence;
  return {
    low: successes === 0 ? 0 : bisect((p) => 1 - binomialCdf(successes - 1, trials, p), alpha / 2, true),
    high: successes === trials ? 1 : bisect((p) => binomialCdf(successes, trials, p), alpha / 2, false),
  };
}

/**
 * The one-sided Clopper-Pearson lower bound: the smallest true rate consistent
 * with the observation at this confidence.
 *
 * Distinct from `clopperPearson().low`, and the distinction has bitten this
 * project's own writing. For 5/5 at 95%, the one-sided lower bound is 0.549
 * while the two-sided interval's lower limit is 0.478, because the two-sided
 * form spends half its error budget on an upper limit that is pinned at 1 and
 * therefore tells you nothing. Quote whichever you like; do not quote one and
 * name the other.
 */
export function clopperPearsonLowerBound(
  successes: number,
  trials: number,
  confidence = 0.95,
): number {
  checkCount(successes, trials);
  if (trials === 0 || successes === 0) return 0;
  return bisect((p) => 1 - binomialCdf(successes - 1, trials, p), 1 - confidence, true);
}

/**
 * McNemar's exact test for a paired before/after comparison.
 *
 * `onlyBefore` counts items the first condition got right and the second got
 * wrong; `onlyAfter` counts the reverse. Items both conditions agree on carry no
 * information about which is better and are correctly absent from the formula —
 * that is the whole point of the pairing, and the reason comparing two overall
 * rates throws evidence away.
 *
 * Returns a two-sided p-value.
 *
 * Worked: mcnemarExact(1, 0) returns 1.0. One outcome changing state between two
 * scorings is no evidence at all that the second scoring is better, which is
 * precisely the shape of the fresh corpus's 0.400 -> 0.300 "improvement".
 */
export function mcnemarExact(onlyBefore: number, onlyAfter: number): number {
  if (!Number.isInteger(onlyBefore) || !Number.isInteger(onlyAfter)) {
    throw new RangeError('discordant counts must be integers');
  }
  if (onlyBefore < 0 || onlyAfter < 0) throw new RangeError('discordant counts must be >= 0');

  const discordant = onlyBefore + onlyAfter;
  // No disagreement is no evidence of a difference, not evidence of sameness.
  if (discordant === 0) return 1;
  const smaller = Math.min(onlyBefore, onlyAfter);
  return Math.min(1, 2 * binomialCdf(smaller, discordant, 0.5));
}

export interface SampleSizeInput {
  /** The rate under the null — typically what is measured today. */
  readonly baseline: number;
  /** The rate to be able to distinguish from it — typically the target. */
  readonly target: number;
  /** Two-sided significance. */
  readonly alpha?: number;
  readonly power?: number;
}

/**
 * How many observations are needed to tell `target` apart from `baseline`.
 *
 * A one-sample test, because that is the question this project actually asks:
 * not "is corpus A better than corpus B" but "is the true miss rate 0.15 or
 * 0.30". Returns the number of *labels* — the unit a corpus is measured in — not
 * the number of outcomes, since one outcome may carry several expected domains.
 *
 * Normal-approximation sizing, which is standard and is the one place a normal
 * approximation is appropriate here: it sizes the experiment rather than
 * reporting its result, and it is used to argue that n is too small, a
 * conclusion no refinement would overturn.
 */
export function requiredTrials(input: SampleSizeInput): number {
  const alpha = input.alpha ?? 0.05;
  const power = input.power ?? 0.8;
  const p0 = input.baseline;
  const p1 = input.target;
  if (p0 === p1) return Infinity;

  const zAlpha = probit(1 - alpha / 2);
  const zBeta = probit(power);
  const numerator =
    zAlpha * Math.sqrt(p0 * (1 - p0)) + zBeta * Math.sqrt(p1 * (1 - p1));
  return Math.ceil((numerator * numerator) / ((p1 - p0) * (p1 - p0)));
}

/**
 * P(rate > `threshold` | observations), under a uniform Beta(1, 1) prior.
 *
 * The Bayesian counterpart to `clopperPearsonLowerBound`, and the quantity a
 * sequential gate is actually stopped on: after each subject, how much of the
 * posterior sits above the bar the gate names. The frequentist bound answers
 * "what could I have observed", which is the wrong question when the design lets
 * you look after every subject — looking repeatedly inflates a fixed-alpha test
 * and does nothing at all to a posterior.
 *
 * Exact, and dependency-free, via the identity that ties the Beta CDF to the
 * binomial one at integer parameters: with a uniform prior the posterior is
 * Beta(s + 1, f + 1), and P(theta > x) is then P(Y <= s) for Y ~ Bin(s + f + 1, x).
 * That is `binomialCdf`, already here. The uniform prior is chosen for exactly
 * this reason — Jeffreys' Beta(1/2, 1/2) would be the better-motivated default
 * and would put half-integers where the identity needs integers.
 *
 * Worked: no observations at all gives P(theta > 0.5) = 0.5, and one success
 * gives 0.75 (the posterior is Beta(2, 1), whose CDF is x^2).
 */
export function posteriorExceeds(
  successes: number,
  failures: number,
  threshold: number,
): number {
  checkCount(successes, successes + failures);
  if (threshold <= 0) return 1;
  if (threshold >= 1) return 0;
  return binomialCdf(successes, successes + failures + 1, threshold);
}

/**
 * The lower limit of the one-sided posterior credible interval: the rate that
 * `confidence` of the posterior mass sits above.
 */
export function credibleLowerBound(
  successes: number,
  failures: number,
  confidence = 0.95,
): number {
  checkCount(successes, successes + failures);
  return bisect((x) => posteriorExceeds(successes, failures, x), confidence, false);
}

export interface SequentialDesign {
  /** The rate the gate claims. Passing means the posterior clears it. */
  readonly bar: number;
  /** Posterior mass above `bar` required to stop and pass. */
  readonly passAt?: number;
  /** Posterior mass above `bar` at or below which the gate stops and fails. */
  readonly futileAt?: number;
  /** The subject budget. Reaching it without either boundary is inconclusive. */
  readonly maxSubjects: number;
}

export interface SequentialOperatingCharacteristics {
  /** P(the gate stops and passes) when the true rate is the one supplied. */
  readonly pass: number;
  /** P(the gate stops early for futility). */
  readonly futile: number;
  /** P(the budget runs out with neither boundary reached). */
  readonly inconclusive: number;
  /** Expected number of subjects spent, the quantity the design exists to cut. */
  readonly expectedSubjects: number;
}

/**
 * What a sequential gate actually does, at a given true success rate.
 *
 * Computed by exact enumeration of the (successes, failures) lattice rather than
 * by simulation: the reachable state space of a gate that stops by 30 subjects
 * is a few hundred cells, so there is no reason to accept Monte Carlo error in a
 * number that decides how many external users a phase costs.
 *
 * The error rates are read off this, not asserted: `pass` evaluated at the bar
 * itself is the design's type-I rate, and `1 - pass` at the rate worth shipping
 * is its type-II rate. A stopping rule quoted without both is a rule nobody
 * has checked.
 */
export function sequentialOperatingCharacteristics(
  design: SequentialDesign,
  trueRate: number,
): SequentialOperatingCharacteristics {
  const passAt = design.passAt ?? 0.95;
  const futileAt = design.futileAt ?? 0.05;
  if (!Number.isInteger(design.maxSubjects) || design.maxSubjects < 1) {
    throw new RangeError('maxSubjects must be a positive integer');
  }

  let pass = 0;
  let futile = 0;
  let expectedSubjects = 0;
  // reachable[s] is the probability of arriving at s successes and n - s
  // failures without having hit a boundary before now.
  let reachable = [1];

  for (let n = 1; n <= design.maxSubjects; n += 1) {
    const next = new Array<number>(n + 1).fill(0);
    for (let s = 0; s < reachable.length; s += 1) {
      const mass = reachable[s]!;
      if (mass === 0) continue;
      next[s + 1] = (next[s + 1] ?? 0) + mass * trueRate;
      next[s] = (next[s] ?? 0) + mass * (1 - trueRate);
    }
    for (let s = 0; s <= n; s += 1) {
      const mass = next[s]!;
      if (mass === 0) continue;
      const above = posteriorExceeds(s, n - s, design.bar);
      if (above >= passAt) {
        pass += mass;
        expectedSubjects += mass * n;
        next[s] = 0;
      } else if (above <= futileAt) {
        futile += mass;
        expectedSubjects += mass * n;
        next[s] = 0;
      }
    }
    reachable = next;
  }

  const inconclusive = reachable.reduce((a, b) => a + b, 0);
  return {
    pass,
    futile,
    inconclusive,
    expectedSubjects: expectedSubjects + inconclusive * design.maxSubjects,
  };
}

/**
 * The pass boundary as a table: for each subject count, the fewest successes
 * that would stop the gate with a pass, or `null` if no result at that n can.
 *
 * This is the form a gate has to be written in to be run by a person who is not
 * holding a posterior in their head.
 */
export function sequentialPassBoundary(design: SequentialDesign): (number | null)[] {
  const passAt = design.passAt ?? 0.95;
  const boundary: (number | null)[] = [];
  for (let n = 1; n <= design.maxSubjects; n += 1) {
    let found: number | null = null;
    for (let s = 0; s <= n; s += 1) {
      if (posteriorExceeds(s, n - s, design.bar) >= passAt) {
        found = s;
        break;
      }
    }
    boundary.push(found);
  }
  return boundary;
}

/**
 * Format a rate with its Wilson interval, for anywhere this project prints a
 * measurement. A rate printed alone is the defect this module exists to fix, so
 * the convenient thing to reach for should be the correct one.
 */
export function formatRate(successes: number, trials: number, confidence = 0.95): string {
  if (trials === 0) return 'n/a (0 observations)';
  const rate = successes / trials;
  const ci = wilson(successes, trials, confidence);
  return `${rate.toFixed(3)} (${successes}/${trials}, 95% CI [${ci.low.toFixed(3)}, ${ci.high.toFixed(3)}])`;
}
