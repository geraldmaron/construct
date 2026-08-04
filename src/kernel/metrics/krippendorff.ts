/**
 * kernel/metrics/krippendorff.ts — Krippendorff's alpha, for multi-label,
 * missing-tolerant coder agreement (construct-2jb.3).
 *
 * Cohen's kappa assumes exactly two coders, one label per unit, and no missing
 * data. None of those hold for a labeling study against this project's domain
 * catalog: 2-3 coders, an outcome can implicate several domains at once, and a
 * coder can leave a unit blank rather than guess. Krippendorff's alpha is the
 * instrument built for that shape (Krippendorff, "Content Analysis: An
 * Introduction to Its Methodology"; Hayes & Krippendorff 2007, "Answering the
 * Call for a Standard Reliability Measure for Coding Data").
 *
 * The formula implemented here is the general pairwise-distance form (Artstein
 * & Poesio 2008, "Inter-Coder Agreement for Computational Linguistics", eq.
 * 6-7), not the coincidence-matrix shortcut most tutorials show:
 *
 *   Do = (1/n) * sum_u [ (1/(m_u - 1)) * sum_{c != c' in u} delta(v_c, v_c') ]
 *   De = (1/(n*(n-1))) * sum_{c != c' in pool} delta(v_c, v_c')
 *   alpha = 1 - Do/De
 *
 * where n is the count of pairable values (values belonging to units with 2 or
 * more coders — a singly-coded unit is dropped from n entirely, per
 * Krippendorff, not just from the pairing), m_u is the number of coders on
 * unit u, and delta is a distance metric supplied by the caller. This form is
 * mathematically equivalent to the coincidence-matrix formula for nominal data
 * (verified in the test file against a published worked example) and, unlike
 * the coincidence-matrix form, generalizes directly to set-valued labels
 * without inventing a binning scheme for the sets.
 *
 * Two distance metrics are provided:
 *   - nominalSetDistance: 0 if the two label sets are identical, else 1. This
 *     is the classic nominal delta, generalized to sets (a single-label value
 *     is just a set of size 1, so this metric reduces to the textbook nominal
 *     case exactly).
 *   - masiDistance: 1 - MASI(A, B), the Measuring Agreement on Set-valued
 *     Items metric (Passonneau, "Measuring Agreement on Set-valued Items
 *     (MASI) for Semantic and Pragmatic Annotation", LREC 2006). MASI is
 *     Jaccard similarity scaled by a monotonicity term that rewards
 *     subset/superset relationships over disjoint-but-overlapping ones, which
 *     is the property that makes it the standard choice for multi-label
 *     Krippendorff's alpha in the annotation literature.
 */

export type LabelSet = ReadonlySet<string>;

export interface Observation {
  readonly unit: string;
  readonly coder: string;
  readonly value: LabelSet;
}

export type Distance = (a: LabelSet, b: LabelSet) => number;

export interface AlphaResult {
  /** Krippendorff's alpha. NaN if there is no disagreement to measure at all
   *  (De = 0: every pairable value in the pool is identical), matching
   *  Krippendorff's own guidance that alpha is undefined, not 1, in that
   *  degenerate case — a corpus with zero variance tells you nothing about
   *  reliability. */
  readonly alpha: number;
  /** Observed disagreement. */
  readonly Do: number;
  /** Expected (chance) disagreement. */
  readonly De: number;
  /** Pairable values: observations belonging to units with >= 2 coders. */
  readonly n: number;
  /** Units that had >= 2 coders and so contributed to n. */
  readonly unitsUsed: number;
  /** Units seen at all, including singly-coded ones dropped from n. */
  readonly unitsTotal: number;
}

/** 0 if the two sets contain exactly the same labels, else 1. */
export function nominalSetDistance(a: LabelSet, b: LabelSet): number {
  if (a.size !== b.size) return 1;
  for (const label of a) if (!b.has(label)) return 1;
  return 0;
}

function jaccard(a: LabelSet, b: LabelSet): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const label of a) if (b.has(label)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/** Passonneau's monotonicity term: 1 identical, 2/3 subset, 1/3 overlapping,
 *  0 disjoint. */
function monotonicity(a: LabelSet, b: LabelSet): number {
  if (a.size === b.size && jaccard(a, b) === 1) return 1;
  const aSubsetB = [...a].every((label) => b.has(label));
  const bSubsetA = [...b].every((label) => a.has(label));
  if (aSubsetB || bSubsetA) return 2 / 3;
  let intersects = false;
  for (const label of a) if (b.has(label)) { intersects = true; break; }
  return intersects ? 1 / 3 : 0;
}

/** 1 - MASI(A, B). MASI = Jaccard(A, B) * monotonicity(A, B). */
export function masiDistance(a: LabelSet, b: LabelSet): number {
  return 1 - jaccard(a, b) * monotonicity(a, b);
}

/**
 * Compute Krippendorff's alpha over a set of (unit, coder, value)
 * observations, under the given distance metric.
 *
 * A unit that only one coder labeled contributes nothing: it cannot be
 * compared against anything, so both Krippendorff's own treatment and this
 * implementation drop it from n rather than padding it with a fabricated
 * second opinion.
 */
export function krippendorffAlpha(
  observations: readonly Observation[],
  distance: Distance,
): AlphaResult {
  const byUnit = new Map<string, Observation[]>();
  for (const obs of observations) {
    const bucket = byUnit.get(obs.unit);
    if (bucket) bucket.push(obs);
    else byUnit.set(obs.unit, [obs]);
  }

  const pairableUnits = [...byUnit.values()].filter((vals) => vals.length >= 2);
  const n = pairableUnits.reduce((sum, vals) => sum + vals.length, 0);

  if (n < 2) {
    return { alpha: NaN, Do: NaN, De: NaN, n, unitsUsed: pairableUnits.length, unitsTotal: byUnit.size };
  }

  let doSum = 0;
  for (const vals of pairableUnits) {
    const m = vals.length;
    let unitSum = 0;
    for (let i = 0; i < m; i += 1) {
      for (let j = 0; j < m; j += 1) {
        if (i === j) continue;
        unitSum += distance(vals[i]!.value, vals[j]!.value);
      }
    }
    doSum += unitSum / (m - 1);
  }
  const Do = doSum / n;

  const pool = pairableUnits.flat();
  let deSum = 0;
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = 0; j < pool.length; j += 1) {
      if (i === j) continue;
      deSum += distance(pool[i]!.value, pool[j]!.value);
    }
  }
  const De = deSum / (n * (n - 1));

  const alpha = De === 0 ? NaN : 1 - Do / De;

  return { alpha, Do, De, n, unitsUsed: pairableUnits.length, unitsTotal: byUnit.size };
}
