/**
 * hosts/architecture.ts — dense-vs-MoE preference, recorded where the matrix
 * actually measured it, not asserted from general reputation.
 *
 * `tuning.ts` records whether a family's output shapes are validated;
 * `floors.ts` records whether a family finishes at all. This records a third,
 * narrower fact: on the composed dispatch-shape depth check
 * (`docs/model-family-promotion.md`), every mixture-of-experts family
 * measured so far has produced clean JSON on every trial and then missed most
 * of the depth rungs — `ollama/gpt-oss:20b` and
 * `openrouter/nvidia/nemotron-3-super-120b-a12b:free`, both recorded there.
 * Two independent MoE families, same failure pattern, is a preference worth
 * surfacing at dispatch time — not proof a dense model of comparable size
 * would pass (no dense open-weight family has cleared the check either),
 * only a caution that a caller choosing between untuned local or open-weight
 * candidates should weigh.
 *
 * It lives host-side for the same reason tuning and floors do: the match is
 * read off vendor model strings, which the kernel never learns.
 *
 * The note names the model it was measured on rather than the tier it might
 * generalise to, same discipline as `floors.ts`: a caution that overstates
 * its reach is still a claim nobody measured.
 */

export interface ArchitectureNote {
  /** Model strings this observation is surfaced for. */
  readonly match: RegExp;
  /** The model it was actually measured on, verbatim. */
  readonly measuredOn: string;
  /** The date of the run behind it. */
  readonly observedOn: string;
  /** What was observed, in one sentence a caller can act on. */
  readonly observation: string;
  /** Where the run is written down. */
  readonly evidence: string;
}

export const ARCHITECTURE_NOTES: readonly ArchitectureNote[] = Object.freeze([
  {
    match: /gpt-oss/i,
    measuredOn: 'ollama/gpt-oss:20b',
    observedOn: '2026-08-05',
    observation:
      'a mixture-of-experts model produced clean JSON on every trial, then missed the depth ' +
      'rungs on the composed dispatch-shape check — the citation gate passed and the plant, ' +
      'cross-reference, and conflict rungs did not',
    evidence: 'docs/model-family-promotion.md, "Record so far" entry for gpt-oss:20b',
  },
  {
    match: /nemotron/i,
    measuredOn: 'openrouter/nvidia/nemotron-3-super-120b-a12b:free',
    observedOn: '2026-08-06',
    observation:
      'a mixture-of-experts model produced clean JSON on every trial, then missed the depth ' +
      'rungs on the composed dispatch-shape check — the citation gate passed and the plant, ' +
      'cross-reference, and conflict rungs did not',
    evidence: 'docs/model-family-promotion.md, "Record so far" entry for nemotron-3-super-120b-a12b',
  },
]);

/**
 * The nearest recorded architecture observation for a model about to be
 * dispatched, or null when none applies. Silence is the common answer and
 * means only that nothing was measured for this model string — never that a
 * dense alternative would do better.
 */
export function architectureNoteFor(model: string | undefined | null): ArchitectureNote | null {
  if (!model) return null;
  return ARCHITECTURE_NOTES.find((note) => note.match.test(model)) ?? null;
}
