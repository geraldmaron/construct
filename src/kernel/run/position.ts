/**
 * kernel/run/position.ts — Construct's own read of what its roles found, and
 * the call that follows from it.
 *
 * THE CORRECTION THIS MODULE IS. Composition was defined as arrangement, and
 * the composer was told in as many words that it may not add a claim, resolve a
 * question the roles left open, or decide something none of them decided. That
 * rule was written against a real failure — a composer asserting scope or
 * sequence that a role had been separately dispatched to establish — and in
 * guarding against it, it forbade the thing that makes a strategy a strategy.
 *
 * What came out was a document in which five specialists each said something
 * true and the reader was left to work out what to do. On one recorded run
 * three of five roles independently reached the same call and the document
 * never said so, because saying so would have been deciding something none of
 * them decided. The reader had to count bullets to find the recommendation.
 * That is not a strategy; it is minutes.
 *
 * THE DISTINCTION THE OLD RULE MISSED. A document like this holds two different
 * kinds of sentence, and only one of them can be fabricated:
 *
 *   A FACT is a thing about the world — what the code does, what the schema
 *   holds, what a document commits to. Construct has no access to any of it
 *   except through a role that read the ground. Inventing one is fabrication,
 *   and the whole apparatus of citation, attribution and per-role screening
 *   exists to make it impossible. None of that changes.
 *
 *   A JUDGMENT is what follows from the facts — which matters more, what to do
 *   first, what to stop, which of two roles is right where they disagree. It
 *   cannot be sourced to anyone, because nobody was asked it. Each role was
 *   asked about its own concern and each was right to answer only that. The
 *   judgment across all of them is the one question nobody was dispatched for,
 *   and leaving it unanswered does not make the document safer — it moves the
 *   hardest part of the work to the person who asked for it.
 *
 * So the prohibition moves from the sentence to the noun. Construct may not add
 * a fact. Construct must produce a judgment. It is the only participant that
 * has read everything, and a run that assembles five expert readings and
 * declines to say what they add up to has stopped one step short of the work.
 *
 * WHAT KEEPS IT HONEST, since this is the loosening of a real safeguard.
 *
 *   - SIGNED. The position is Construct's and says so. A reader can always tell
 *     which sentences are a specialist's finding and which are the synthesis,
 *     because they are in different parts of the document under different
 *     names.
 *   - RESTS ON WHAT WAS ESTABLISHED. The position names the roles it is built
 *     on, and an attribution to a role that produced no deliverable is refused
 *     structurally, the same way a composed claim's is.
 *   - CHECKED BY THE ROLES IT LEANS ON. Each role sees the position beside its
 *     own deliverable and says whether it misrepresents what that deliverable
 *     established. That is a real veto and it costs nothing extra: the roles are
 *     already asked about the claims drawn from them, and this rides the same
 *     call.
 *   - OWES THE CASE AGAINST ITSELF. A recommendation shipped without its
 *     strongest objection and its most likely failure is an advertisement. Both
 *     are already structural checks in the catalog and both are required here.
 *
 * RESOLVING A DISAGREEMENT IS NOW PART OF THE JOB. The closing round refuses to
 * settle a contested gap by arrival order, and that refusal was right about
 * arrival order and wrong to generalise: order of arrival is not a reason, and
 * reasoning is. Where two roles cannot both be acted on, the position says which
 * way it went and why, and names the side it did not take rather than deleting
 * it. What it may not do is average them into a sentence neither role would
 * recognise.
 *
 * AND WHERE IT GENUINELY CANNOT DECIDE, it says what specifically would decide
 * it — a document, a number, a person's answer. Not the menu again. "I cannot
 * choose between these five" is the failure this module exists to end, and it
 * does not become acceptable by being phrased as a question.
 */

/** One thing the position asserts, and the roles whose work it rests on. */
export interface PositionClaim {
  readonly text: string;
  /** Roles whose deliverables support this. Never empty. */
  readonly restsOn: readonly string[];
}

/** A disagreement the position settled, with the side it did not take. */
export interface Resolution {
  /** What the two roles could not both be right about. */
  readonly question: string;
  /** The role whose reading the position took. */
  readonly took: string;
  /** The role whose reading it did not, named rather than dropped. */
  readonly over: string;
  /** Why — a reason a reader can disagree with, never an order of arrival. */
  readonly because: string;
}

/**
 * Construct's read: the call, what it rests on, what it resolved, and the case
 * against it.
 */
export interface ConstructPosition {
  /** The call, in one or two sentences, stated as a commitment. */
  readonly approach: string;
  /** What the approach rests on, each tied to the roles that established it. */
  readonly because: readonly PositionClaim[];
  /** Disagreements it settled, each with the side not taken. */
  readonly resolved: readonly Resolution[];
  /** What this displaces, stops, or defers to be true. */
  readonly costs: readonly PositionClaim[];
  /** The order, and what must hold before the next thing starts. */
  readonly first: readonly PositionClaim[];
  /** The best argument against the call, in its own words. */
  readonly strongestObjection: string;
  /** Assume the call was taken and failed: the most likely story of how. */
  readonly preMortem: string;
  /**
   * What would decide anything it could not. Empty is a real answer and the
   * expected one; a long list is the run handing the menu back in a new shape.
   */
  readonly undecided: readonly {
    readonly question: string;
    /** The document, number, or person's answer that would settle it. */
    readonly settledBy: string;
  }[];
}

export interface ScreenedPosition {
  readonly position: ConstructPosition;
  /** Claims dropped before anyone was asked to verify them, with the reason. */
  readonly refused: readonly { readonly text: string; readonly reason: string }[];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asString).filter((s) => s.length > 0) : [];
}

function toClaims(value: unknown): PositionClaim[] {
  if (!Array.isArray(value)) return [];
  const claims: PositionClaim[] = [];
  for (const item of value) {
    const entry = item as { text?: unknown; restsOn?: unknown } | null;
    const text = asString(entry?.text);
    const restsOn = asStrings(entry?.restsOn);
    if (text.length > 0) claims.push({ text, restsOn });
  }
  return claims;
}

/** Read a position out of a host reply, taking nothing on trust. */
export function toPosition(parsed: unknown): ConstructPosition | null {
  const record = parsed as Record<string, unknown> | null;
  const approach = asString(record?.approach);
  if (approach.length === 0) return null;

  const resolved: Resolution[] = [];
  for (const item of Array.isArray(record?.resolved) ? record.resolved : []) {
    const entry = item as Record<string, unknown> | null;
    const question = asString(entry?.question);
    const took = asString(entry?.took);
    const over = asString(entry?.over);
    const because = asString(entry?.because);
    if (question && took && over && because) resolved.push({ question, took, over, because });
  }

  const undecided: { question: string; settledBy: string }[] = [];
  for (const item of Array.isArray(record?.undecided) ? record.undecided : []) {
    const entry = item as Record<string, unknown> | null;
    const question = asString(entry?.question);
    const settledBy = asString(entry?.settledBy);
    if (question && settledBy) undecided.push({ question, settledBy });
  }

  return {
    approach,
    because: toClaims(record?.because),
    resolved,
    costs: toClaims(record?.costs),
    first: toClaims(record?.first),
    strongestObjection: asString(record?.strongestObjection),
    preMortem: asString(record?.preMortem),
    undecided,
  };
}

/**
 * Refuse what the position may not have.
 *
 * Structural and free, run before anybody is asked to judge it — the same
 * order the composed claims are screened in, and for the same reason: an
 * attribution to a role that does not exist is fabricated provenance rather
 * than a difference of opinion, and there is nothing for a model to weigh.
 *
 * A claim resting on nobody is refused too. That is the fabrication this whole
 * design is guarding while it lets the judgment through: a factual sentence
 * with no role behind it came from the composer's own knowledge of the world,
 * which it has no license to use here.
 */
export function screenPosition(
  position: ConstructPosition,
  roles: readonly string[],
): ScreenedPosition {
  const known = new Set(roles);
  const refused: { text: string; reason: string }[] = [];

  const keep = (claims: readonly PositionClaim[]): PositionClaim[] => {
    const kept: PositionClaim[] = [];
    for (const claim of claims) {
      if (claim.restsOn.length === 0) {
        refused.push({
          text: claim.text,
          reason:
            'rests on no role — a statement of fact with nothing behind it is the composer ' +
            'using what it happens to know, which is the one thing it may not do here',
        });
        continue;
      }
      const unknown = claim.restsOn.filter((role) => !known.has(role));
      if (unknown.length > 0) {
        refused.push({
          text: claim.text,
          reason: `rests on ${unknown.join(', ')}, which produced no deliverable in this run`,
        });
        continue;
      }
      kept.push(claim);
    }
    return kept;
  };

  const resolved = position.resolved.filter((r) => {
    if (known.has(r.took) && known.has(r.over)) return true;
    refused.push({
      text: r.question,
      reason: `settles a disagreement between roles this run did not dispatch (${r.took}, ${r.over})`,
    });
    return false;
  });

  return {
    position: {
      ...position,
      because: keep(position.because),
      costs: keep(position.costs),
      first: keep(position.first),
      resolved,
    },
    refused,
  };
}

/**
 * Whether the position is a position.
 *
 * A recommendation with no case against it and no failure story is an
 * advertisement, and both of those are things this system holds every role to.
 * Holding its own synthesis to a lower bar than the work it synthesises would
 * be the exact inversion of the standard.
 */
export function positionShortfalls(position: ConstructPosition): string[] {
  const missing: string[] = [];
  if (position.strongestObjection.length === 0) {
    missing.push('the strongest argument against this call is not stated');
  }
  if (position.preMortem.length === 0) {
    missing.push('no pre-mortem: the most likely way this fails is not written down');
  }
  if (position.because.length === 0) {
    missing.push('the call rests on nothing any role established');
  }
  return missing;
}
