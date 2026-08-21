/**
 * hosts/dispatchshape.ts — dated, measured facts about how a family shapes
 * its actual deliverables against real templates, distinct from whether its
 * JSON seams parse.
 *
 * `floors.ts`'s per-model fixtures (`fixtures/model-floors/`) measure whether
 * the namer and densifier hold their two host-backed JSON seams. A model can
 * pass both cleanly on every trial and still never produce the domain
 * template's required headed sections, or carry honest citations in a format
 * the automated tier-1 citation check cannot recognise — both are facts about
 * the deliverable a user actually reads, not about the namer or densifier
 * seam, and neither shows up in a namer/densifier probe. This module records
 * that narrower fact where it was actually measured: a reader-rubric panel
 * reading real `ask` deliverables end to end, not the composed dispatch-shape
 * depth check `architecture.ts` measures.
 *
 * It lives host-side for the same reason tuning, floors, and architecture do:
 * the match is read off vendor model strings, which the kernel never learns.
 *
 * Same discipline as its siblings: the note names the model actually
 * measured, not the tier it might generalise to, and evidence points at the
 * dated record — here, the same per-model floor record `floors.ts`'s sibling
 * fixtures live in — so a reader can trace the claim back to the runs behind
 * it.
 */

export interface DispatchShapeNote {
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

export const DISPATCH_SHAPE_NOTES: readonly DispatchShapeNote[] = Object.freeze([
  {
    match: /gpt-oss/i,
    measuredOn: 'ollama/gpt-oss:20b',
    observedOn: '2026-08-21',
    observation:
      'across four real dispatches read back through a reader-rubric panel, this family never used a domain ' +
      "template's required headed sections — it substituted one generic answer/evidence/limits shape every " +
      'time — and carried honest citations as a plain-prose "(engagement)" tag rather than the ' +
      '[cite:engagement]/[unverified] bracket syntax the automated tier-1 citation check expects',
    evidence: 'fixtures/model-floors/2026-08-06-ollama-gpt-oss-20b.json, "findings" entries dated 2026-08-21',
  },
]);

/**
 * The nearest recorded dispatch-shape observation for a model about to run,
 * or null when none applies. Silence is the common answer and means only
 * that nothing was measured for this model string — never that its
 * deliverables will hold template structure or citation format.
 */
export function dispatchShapeNoteFor(model: string | undefined | null): DispatchShapeNote | null {
  if (!model) return null;
  return DISPATCH_SHAPE_NOTES.find((note) => note.match.test(model)) ?? null;
}
