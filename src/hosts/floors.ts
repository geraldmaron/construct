/**
 * hosts/floors.ts — dated, measured throughput floors: the ground sizes at
 * which a locally-served family was observed to produce nothing inside the
 * host's invocation timeout.
 *
 * `tuning.ts` records whether a family's output shapes are validated. This
 * records something narrower and more brutal: whether a family finishes at
 * all. A model can parse every reply cleanly and still be unable to read a
 * real repository inside ten minutes, and the second fact is the one a user
 * meets first — as ten minutes per role, spent, with nothing to show.
 *
 * It lives host-side for the same reason tuning does: the match is read off
 * vendor model strings, which the kernel never learns.
 *
 * Two rules keep an entry honest. It names the model it was measured on rather
 * than the tier it might generalise to, and it is surfaced as the nearest
 * recorded observation rather than as a prediction about the caller's model.
 * A caution that overstates its reach is still a claim nobody measured.
 */

export interface DispatchFloor {
  /** Model strings this observation is surfaced for. */
  readonly match: RegExp;
  /** The model it was actually measured on, verbatim. */
  readonly measuredOn: string;
  /** The date of the run behind it. */
  readonly observedOn: string;
  /** Ground size, in surveyed documents, at which it was observed. */
  readonly documents: number;
  /** The invocation limit it did not finish inside. */
  readonly timeoutMs: number;
  /** What happened, in one sentence a user can act on. */
  readonly observation: string;
  /** Where the run is written down. */
  readonly evidence: string;
}

export const DISPATCH_FLOORS: readonly DispatchFloor[] = Object.freeze([
  {
    // Locally-served models generally, because the constraint measured here is
    // consumer hardware rather than one checkpoint's quality, and a caution
    // that only fires on the exact string it was measured on never fires.
    // The notice states which model produced it so the reader can weigh it.
    match: /^ollama\//i,
    measuredOn: 'ollama/qwen3.6:35b',
    observedOn: '2026-08-10',
    documents: 40,
    timeoutMs: 600000,
    observation:
      'a 35b-class local model surveyed 40 documents, then every one of four grounded dispatches ' +
      'hit the ten-minute host timeout having produced nothing — ten minutes per role, spent',
    evidence: 'docs/internal/stakeholder-acceptance-phase-5.md, Case 0',
  },
]);

/**
 * The nearest recorded observation for a dispatch about to run, or null when
 * none applies. Silence is the common answer and means only that nothing was
 * measured here — never that the dispatch will finish.
 */
export function dispatchFloorFor(
  model: string | undefined | null,
  documents: number,
): DispatchFloor | null {
  if (!model) return null;
  return (
    DISPATCH_FLOORS.find((f) => f.match.test(model) && documents >= f.documents) ?? null
  );
}
