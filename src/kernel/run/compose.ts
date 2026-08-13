/**
 * kernel/run/compose.ts — one document out of the several a run produced.
 *
 * A run that implicates three concerns dispatches three roles and returns
 * three deliverables. Synthesis merges their *issues*; nothing writes the
 * document. Asked to "write the strategy", Construct returned the bet and the
 * price from one role, the scope from another, the sequence from a third, and
 * each correctly declined to claim the whole — the whole is not any one of
 * their concerns. Composing was left to the reader, silently, which reads as
 * the system having answered when it has not (RESEARCH-DECISIONS 19).
 *
 * The composer's entire discipline is that it may not introduce anything. Its
 * inputs are deliverables that already passed their own challenges, and its
 * job is arrangement: what each concern established, where they disagree, and
 * what the outcome asked for that none of them covered. A composer that adds a
 * claim is doing the thing an authoring playbook was rejected for — asserting
 * scope or sequence that a role was separately dispatched to establish.
 *
 * So every claim carries the role it came from, and two screens sit under that:
 *
 *   - Structural, here: an attribution naming a role that produced no
 *     deliverable in this run is fabricated provenance, the same class the
 *     source-read gate exists for, and it is refused rather than judged.
 *   - Substantive, through the host: each role is shown its own deliverable
 *     beside every claim attributed to it and asked which it does not support.
 *     Per role rather than per claim on purpose — the coverage is identical
 *     and the cost is bounded by the number of concerns rather than by how
 *     many sentences the composer wrote.
 *
 * A run with one deliverable composes nothing and says so. Arranging one
 * document into one document is a paraphrase, and a paraphrase of a checked
 * deliverable is an unchecked one.
 */

/** One role's finished work, as the composer receives it. */
export interface SourceDeliverable {
  readonly role: string;
  readonly text: string;
}

/** One claim in the composition, and the role whose deliverable it came from. */
export interface ComposedClaim {
  readonly section: string;
  readonly text: string;
  readonly from: string;
}

export interface Composition {
  readonly claims: readonly ComposedClaim[];
  /**
   * What the outcome asked for that no deliverable covered. Required and
   * allowed to be empty only by saying so: a composition silently missing a
   * third of the ask is the failure mode composing introduces.
   */
  readonly uncovered: readonly string[];
}

export interface ScreenedComposition {
  readonly claims: readonly ComposedClaim[];
  readonly uncovered: readonly string[];
  /** Claims dropped before anyone was asked to verify them, each with its reason. */
  readonly discarded: readonly { readonly claim: ComposedClaim; readonly reason: string }[];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Validate a parsed composer reply. Malformed items become reasons rather than
 * exceptions, the same as every other reading pass here: one bad claim does
 * not cost the document.
 */
export function toComposition(parsed: unknown): Composition {
  const record = parsed as { claims?: unknown; uncovered?: unknown } | null;
  const claims: ComposedClaim[] = [];
  for (const item of Array.isArray(record?.claims) ? record.claims : []) {
    const c = item as { section?: unknown; text?: unknown; from?: unknown } | null;
    const section = asString(c?.section);
    const text = asString(c?.text);
    const from = asString(c?.from);
    if (!section || !text || !from) continue;
    claims.push({ section, text, from });
  }
  const uncovered: string[] = [];
  for (const item of Array.isArray(record?.uncovered) ? record.uncovered : []) {
    const gap = asString(item);
    if (gap) uncovered.push(gap);
  }
  return { claims, uncovered };
}

/**
 * Refuse what the run cannot vouch for: a claim attributed to a role that
 * produced no deliverable here. Structural and deterministic — whether the
 * deliverable actually says it is the substantive question, and a model
 * answers that one.
 */
export function screenComposition(
  composition: Composition,
  sources: readonly SourceDeliverable[],
): ScreenedComposition {
  const roles = new Set(sources.map((s) => s.role));
  const claims: ComposedClaim[] = [];
  const discarded: { claim: ComposedClaim; reason: string }[] = [];
  for (const claim of composition.claims) {
    if (!roles.has(claim.from)) {
      discarded.push({
        claim,
        reason:
          `attributed to ${claim.from}, which produced no deliverable in this run — ` +
          'a composition may arrange what the roles established and may not add to it',
      });
      continue;
    }
    claims.push(claim);
  }
  return { claims, uncovered: composition.uncovered, discarded };
}

/** Claims attributed to one role, for the pass that asks whether it said them. */
export function claimsFrom(claims: readonly ComposedClaim[], role: string): ComposedClaim[] {
  return claims.filter((claim) => claim.from === role);
}

/** What one role's deliverable does not support, as that pass reported it. */
export interface SupportVerdict {
  /** Indices into the claims that pass was given, which it says are unsupported. */
  readonly unsupported: readonly number[];
  readonly detail: string;
}

/**
 * A model shown one deliverable and the claims drawn from it, asked which the
 * deliverable does not support. Throws on failure; an unverified composition
 * is reported, never quietly promoted.
 */
export type SupportChecker = (
  source: SourceDeliverable,
  claims: readonly ComposedClaim[],
) => Promise<SupportVerdict>;

export interface ComposeReadiness {
  readonly ready: boolean;
  /** Why not, in the words a caller prints. */
  readonly reason: string;
}

/**
 * Whether there is anything to compose. Two deliverables is the floor: with
 * one, arranging a document into a document is a paraphrase, and a paraphrase
 * of a checked deliverable is an unchecked one.
 */
export function composeReadiness(sources: readonly SourceDeliverable[]): ComposeReadiness {
  const usable = sources.filter((s) => s.text.trim() !== '');
  if (usable.length === 0) {
    return { ready: false, reason: 'no task in this run produced a deliverable' };
  }
  if (usable.length === 1) {
    return {
      ready: false,
      reason:
        `only ${usable[0]?.role ?? 'one role'} produced a deliverable, so there is nothing to ` +
        'compose — read it directly rather than paying for a paraphrase of it',
    };
  }
  return { ready: true, reason: '' };
}
