/**
 * kernel/intake/densify.ts — the seam through which a rough outcome is
 * optimized before anything reads it.
 *
 * Measured against the harvested corpus of real framings: outcomes arrive as
 * long, nonlinear, often dictated text — fillers, corrections, several
 * concerns in one breath — and the keyword map reads none of it (two corpus
 * framings implicated zero domains on recorded runs). The users producing
 * those framings were also observed appending "optimize this prompt" by hand,
 * session after session. That optimization is intake's job, not the user's
 * discipline.
 *
 * The kernel defines the shape and stays host-ignorant, exactly as
 * implication/naming.ts does for the namer. Three rules the shape enforces:
 *
 *   - The original text is never replaced. The densified form is a companion
 *     fact recorded alongside it; the run's outcome stays the user's words.
 *   - Densification only happens when a host is named — it is a model call,
 *     and the free path passes the raw text through and says so, which is the
 *     honest degradation rather than a silent one.
 *   - A failed densifier is a stated fallback to the raw text, never a guess.
 */

export interface DensifiedIntake {
  /** The primary outcome, restated in one plain sentence. */
  readonly outcome: string;
  /** Explicit and clearly implied constraints, in the user's own terms. */
  readonly constraints: readonly string[];
  /** Decisions the text shows as already made — not open questions. */
  readonly decisions: readonly string[];
  /** Tangents worth keeping visible that are not this outcome. */
  readonly parked: readonly string[];
}

/** A model-backed densifier. Throws on failure; the caller states the fallback. */
export type Densifier = (raw: string) => Promise<DensifiedIntake>;

/**
 * Validate a parsed reply into the shape above. Strings only, trimmed,
 * empties dropped: a densified outcome that is blank is a failure, not a
 * result, because downstream naming would silently read nothing.
 */
export function toDensifiedIntake(parsed: unknown): DensifiedIntake {
  const record = parsed as {
    outcome?: unknown;
    constraints?: unknown;
    decisions?: unknown;
    parked?: unknown;
  } | null;
  const outcome = typeof record?.outcome === 'string' ? record.outcome.trim() : '';
  if (!outcome) {
    throw new Error('the densified reply has no outcome sentence');
  }
  const strings = (value: unknown): readonly string[] =>
    Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim())
      : [];
  return {
    outcome,
    constraints: strings(record?.constraints),
    decisions: strings(record?.decisions),
    parked: strings(record?.parked),
  };
}
