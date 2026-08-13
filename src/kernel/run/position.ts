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
 *   - CHECKED BY THE ROLES IT LEANS ON, AND SENT BACK ONCE WHEN THEY OBJECT.
 *     Each role sees the position beside its own deliverable and says whether it
 *     misrepresents what that deliverable established. That is a real veto and
 *     it costs nothing extra: the roles are already asked about the claims drawn
 *     from them, and this rides the same call. An objection of that kind is
 *     specific enough to fix — the sentence is quoted — so the position goes
 *     back with it, exactly as a deliverable that fails its checks does, rather
 *     than being printed beside a correction the reader is left to apply. What
 *     cannot be repaired prints with its objections, which is where this
 *     started.
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

import { roleLookup } from './rolekey.ts';

/** One thing the position asserts, and the roles whose work it rests on. */
export interface PositionClaim {
  readonly text: string;
  /** Roles whose deliverables support this. Never empty. */
  readonly restsOn: readonly string[];
}

/**
 * A disagreement the position settled, with the side it did not take.
 *
 * Both sides are lists because a real disagreement is rarely one role against
 * one role. Measured on a live composition, the most common shape is several
 * roles converging on one reading and one holding out against it, and a field
 * that admits a single name forces the model to either drop the roles that do
 * not fit or write a composite that names no role at all — which is what it
 * did, and the screen then refused work that was sound because it could not be
 * expressed. A side naming nobody is still refused; that is the fabrication
 * this guards, and it is a different thing from a side naming three.
 */
export interface Resolution {
  /** What the roles could not both be right about. */
  readonly question: string;
  /** The roles whose reading the position took. Never empty. */
  readonly took: readonly string[];
  /** The roles whose reading it did not, named rather than dropped. */
  readonly over: readonly string[];
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

/**
 * One role saying the call states its work as something it did not establish,
 * in the role's own words: the sentence it objects to, quoted.
 */
export interface PositionObjection {
  readonly role: string;
  readonly quote: string;
}

/** The same sentence objected to, once, naming every role that raised it. */
export interface SharedObjection {
  readonly quote: string;
  readonly roles: readonly string[];
}

/** A position as it stood after one screening and one round of objections. */
export interface PositionAttempt {
  readonly objections: readonly PositionObjection[];
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

/**
 * The roles a side of a disagreement names, read out of what a model actually
 * writes there.
 *
 * Measured on a live composition, a side arrives in three shapes: a bare role
 * name, several roles joined ("evidence-provenance + privacy + product-scoping"),
 * and a role with the model's own gloss attached ("strategy-alignment (which
 * favored mobile-launch-completion first)"). Only the first survives a literal
 * read, and the other two were refused as roles the run never dispatched —
 * refusing sound work for how it was punctuated.
 *
 * So the separators are split on and a trailing parenthetical is dropped. This
 * is lenient about form and not at all about substance: what comes out is
 * checked against the roles that actually ran, and a side that names nobody the
 * run dispatched is still refused. Reading a name out of "a + b" is recovering
 * what the model meant; inventing one is not, and screenPosition still decides
 * which happened.
 */
export function rolesNamed(value: unknown): string[] {
  const raw = asString(value);
  if (raw.length === 0) return [];
  const named: string[] = [];
  for (const piece of raw.split(/\s*(?:\+|,|\/|;|\band\b)\s*/i)) {
    const role = piece
      .replace(/\([^)]*\)/g, '')
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .trim();
    if (role.length > 0 && !named.includes(role)) named.push(role);
  }
  return named;
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
    const took = Array.isArray(entry?.took) ? asStrings(entry.took) : rolesNamed(entry?.took);
    const over = Array.isArray(entry?.over) ? asStrings(entry.over) : rolesNamed(entry?.over);
    const because = asString(entry?.because);
    if (question && took.length > 0 && over.length > 0 && because) {
      resolved.push({ question, took, over, because });
    }
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
 *
 * Matching, here as in compose.ts's screenComposition, is lenient about how a
 * role's name is spelled and strict about which role it resolves to — see
 * rolekey.ts. Every role a claim survives on is canonicalized to its real id,
 * so a claim that rested on "Product Scoping" reads, downstream, exactly as
 * one that rested on "product-scoping" would.
 */
export function screenPosition(
  position: ConstructPosition,
  roles: readonly string[],
): ScreenedPosition {
  const resolve = roleLookup(roles);
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
      const resolved = claim.restsOn.map((role) => resolve(role));
      const unknown = claim.restsOn.filter((_, i) => resolved[i] === undefined);
      if (unknown.length > 0) {
        refused.push({
          text: claim.text,
          reason: `rests on ${unknown.join(', ')}, which produced no deliverable in this run`,
        });
        continue;
      }
      kept.push({ ...claim, restsOn: resolved as string[] });
    }
    return kept;
  };

  // A side is kept for the roles it names that actually ran. Dropping a
  // stranger from a side of three leaves a disagreement the run can still
  // stand behind; a side left naming nobody is the fabrication, and the whole
  // resolution goes.
  const resolved: Resolution[] = [];
  for (const r of position.resolved) {
    const took = r.took.map((role) => resolve(role)).filter((role): role is string => role !== undefined);
    const over = r.over.map((role) => resolve(role)).filter((role): role is string => role !== undefined);
    if (took.length > 0 && over.length > 0) {
      resolved.push({ ...r, took, over });
      continue;
    }
    const strangers = [...r.took, ...r.over].filter((role) => resolve(role) === undefined);
    refused.push({
      text: r.question,
      reason: `settles a disagreement between roles this run did not dispatch (${strangers.join(', ')})`,
    });
  }

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
/**
 * The same sentence, however many roles quoted it.
 *
 * Three roles objecting to one clause is one problem with the call, not three,
 * and printing it three times tells the reader that the call is in worse shape
 * than it is while burying which sentence is actually contested. It is also the
 * strongest signal the objections carry: a sentence three roles independently
 * reached for is the one the repair has to fix.
 *
 * Matched on the words rather than the characters — a role that quotes with
 * different capitalisation, surrounding quote marks, or wrapped whitespace has
 * quoted the same sentence, and treating those as different objections would
 * defeat the collapse in exactly the cases it exists for.
 */
function quoteKey(quote: string): string {
  return quote
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function collapseObjections(
  objections: readonly PositionObjection[],
): readonly SharedObjection[] {
  const byQuote = new Map<string, { quote: string; roles: string[] }>();
  for (const objection of objections) {
    const key = quoteKey(objection.quote);
    if (key.length === 0) continue;
    const entry = byQuote.get(key);
    if (entry === undefined) {
      byQuote.set(key, { quote: objection.quote.trim(), roles: [objection.role] });
      continue;
    }
    if (!entry.roles.includes(objection.role)) entry.roles.push(objection.role);
  }
  return [...byQuote.values()];
}

/**
 * Whether the call that came back is better than the one that went out.
 *
 * The rule is the repair round's, and it is here for the reason it is there: an
 * instruction is not a mechanism. Told that one sentence misreads one role, a
 * model rewrites the call, and the rewrite can trade the objection it was sent
 * back for against a new one — or lose the attributions that made the old
 * version screenable in the first place, which is the failure mode unique to
 * this pass, since a position is admitted claim by claim on what it rests on.
 *
 * So a second attempt is taken only when the objections it leaves are a strict
 * subset of the ones it was sent back for AND it brought back no refusal the
 * first attempt did not already have. Fixed something and broke nothing is a
 * repair. Anything else is a rewrite, and the run keeps the call it already
 * had, which is a known quantity that prints with its objections beside it.
 *
 * Equal objection sets are refused too: a second attempt that fixed nothing
 * spent a call to produce a different document with the same standing.
 */
export function positionRepairIsAnImprovement(
  before: PositionAttempt,
  after: PositionAttempt,
): boolean {
  const objectionKey = (o: PositionObjection): string => `${o.role} ${quoteKey(o.quote)}`;
  const was = new Set(before.objections.map(objectionKey));
  const now = new Set(after.objections.map(objectionKey));
  if (now.size >= was.size) return false;
  for (const key of now) if (!was.has(key)) return false;

  const refusedBefore = new Set(before.refused.map((r) => quoteKey(r.text)));
  for (const refusal of after.refused) {
    if (!refusedBefore.has(quoteKey(refusal.text))) return false;
  }
  return true;
}

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
