/**
 * hosts/tuning.ts — the model matrix's tuning record: which model families the
 * producer prompts are validated against, and the honest label for everything
 * else.
 *
 * The matrix is deliberately staggered (STRATEGY Phase 4): a small set of
 * families is tuned and eval-gated — producer prompts validated against the
 * family's actual output shapes, scored fixture-organization runs on record —
 * and every other family runs labeled best-effort until real use pulls it into
 * tuning. Format and vocabulary vary by provider, so an untuned family's
 * output may parse worse and cite differently; the label makes that limit
 * travel with the deliverable instead of surfacing as a mystery downstream.
 *
 * This lives host-side because family membership is read off vendor model
 * strings, and the kernel never learns those — adapters answer through the
 * optional `modelTuning` seam and the kernel relays what they said.
 *
 * The stamp is stale-loudly: it names the date the tuning evidence was
 * recorded, so a reader a year from now sees an old date, not a fresh-looking
 * claim. Append entries when a family's eval gate passes; never backdate.
 */

export interface TunedFamily {
  /** The family name a work-log reader sees. */
  readonly family: string;
  /** Matches the host's `provider/model` (or bare model) strings. */
  readonly match: RegExp;
  /** The date the family's eval-gate evidence was recorded. */
  readonly tunedOn: string;
  /** Where the evidence lives. */
  readonly evidence: string;
}

export const TUNED_FAMILIES: readonly TunedFamily[] = Object.freeze([
  {
    family: 'claude',
    match: /(^|\/)claude-/i,
    tunedOn: '2026-08-05',
    evidence: 'fixture-organization scored runs (clean-context lens runs, all rungs)',
  },
]);

export interface ModelTuning {
  /** The tuned family the model belongs to, or null when none matches. */
  readonly family: string | null;
  readonly tuned: boolean;
}

/**
 * Whether a model string belongs to a tuned family. Unrecognised is untuned,
 * not unknown: the question is "is there tuning evidence for this model", and
 * for a model no entry matches, the answer is no.
 */
export function tuningOf(model: string | undefined | null): ModelTuning {
  if (!model) return { family: null, tuned: false };
  const hit = TUNED_FAMILIES.find((f) => f.match.test(model));
  return hit ? { family: hit.family, tuned: true } : { family: null, tuned: false };
}

/** The degradation note recorded whenever an untuned family runs. */
export const BEST_EFFORT_NOTE =
  'best-effort: producer prompts are not validated against this model family; ' +
  'output shape and citation habits are unmeasured for it, and any claim about ' +
  'this run carries that qualification';

/**
 * The one-line matrix stamp for doctor/version. It carries the as-of dates so
 * going stale is visible in the output itself.
 */
export function tuningStamp(): string {
  const families = TUNED_FAMILIES.map((f) => `${f.family} (tuned ${f.tunedOn})`).join(', ');
  return `model matrix: tuned families ${families}; every other family runs best-effort with degradation notes`;
}
