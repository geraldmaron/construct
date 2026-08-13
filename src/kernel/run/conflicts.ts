/**
 * kernel/run/conflicts.ts — turning two disagreeing roles into one framed
 * decision the user makes.
 *
 * Commitment 2: work happens in the background and only calls that are
 * genuinely the user's surface. Commitment 11: a cross-domain conflict surfaces
 * framed with both sides cited, with no hidden precedence order and no
 * auto-arbitration on a judgment call.
 *
 * The hard part is detection, and the honest answer is that a role has to say
 * where it stands rather than have it read out of its prose. "This is
 * concerning" and "this is fine" are not reliably separable by a matcher, and a
 * matcher that got it wrong would either invent a conflict or bury one — both
 * of which are commitment 15 failures wearing a different hat. So the
 * assignment asks for a declared stance in a fixed shape and this module parses
 * exactly that shape. A deliverable that does not declare one contributes no
 * position; it is not guessed at.
 *
 * `unclear` is a first-class answer for the same reason. A role forced to pick
 * a side it cannot support would manufacture exactly the confident conflict this
 * system is supposed to avoid.
 *
 * Nothing here decides anything. It produces the framing; resolution arrives
 * from the user through store/decisions.ts.
 */

import type { Position, RaiseDecision } from '../store/decisions.ts';

export const STANCES = ['proceed', 'hold', 'unclear'] as const;

export type Stance = (typeof STANCES)[number];

export interface DeclaredStance {
  readonly stance: Stance;
  /**
   * What the role wrote after the stance word, when that is a qualifier rather
   * than punctuation — "with conditions", "on the launch" — or null when it
   * declared the stance plainly.
   *
   * This exists because the qualifier is part of the position, not noise around
   * it. A role writing "proceed with conditions" and naming a
   * precondition has not taken the same position as one writing "proceed", and
   * recording them identically puts the plainer, more confident position in the
   * qualified role's mouth.
   */
  readonly qualifier: string | null;
  /** The role's one-line reason, or null if it declared none. */
  readonly because: string | null;
  /** What it says it is relying on, or null when it cited nothing. */
  readonly citation: string | null;
}

/**
 * How a stance reads back to the user: the declared word, plus the role's own
 * qualifier when it wrote one. Never plainer than what the role declared.
 */
export function stanceLabel(declared: DeclaredStance): string {
  return declared.qualifier ? `${declared.stance} ${declared.qualifier}` : declared.stance;
}

/** The three lines every role is asked to end with. */
export const STANCE_PROTOCOL = [
  'End your answer with these three lines, exactly:',
  'STANCE: proceed | hold | unclear',
  'BECAUSE: <one sentence>',
  'CITE: <the rule, document, or fact you are relying on — or "none">',
  '',
  '"hold" means this outcome should not go ahead as stated until something is',
  'resolved. "unclear" is a real answer — do not pick a side you cannot support.',
].join('\n');

/**
 * Strip the decoration a model puts around a labeled line. Live runs return
 * `**STANCE:** hold`, `- STANCE: hold`, and `### STANCE: hold` for the same
 * instruction; the label is what matters, not the markdown around it.
 * Exported for every declared-line protocol, so ASK and STANCE cannot drift
 * into two parsers that disagree about the same markdown.
 */
export function undecorate(line: string): string {
  return line
    .replace(/[*_`>#]/g, '')
    .replace(/^\s*[-+•]\s*/, '')
    .trim();
}

export function labeled(lines: readonly string[], label: string): string | null {
  const pattern = new RegExp(`^${label}\\s*[:\\-–]\\s*(.+)$`, 'i');
  // Last wins: a model that restates the block (a summary, then the real one)
  // means the final declaration, and an earlier draft of it is not the answer.
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = pattern.exec(lines[i]);
    if (match) return match[1].trim();
  }
  return null;
}

/** A cited "none" is not a citation. */
function citationOrNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.replace(/^["'`]|["'`]$/g, '').trim();
  if (!trimmed || /^(none|n\/a|na|nothing|unknown)\b/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * The stance a deliverable declared, or null if it declared none.
 *
 * Strict on the vocabulary and forgiving on the formatting: only the three
 * declared words count, but they are found through whatever markdown the model
 * wrapped them in. A missing block, a sentence where the stance should be, or a
 * first word outside the vocabulary reads as "no stance declared", which is the
 * safe answer because it removes the role from the framing rather than putting a
 * position in its mouth.
 *
 * Words AFTER a valid stance word are kept as a qualifier rather than dropped
 *. A live run produced "STANCE: proceed with conditions" over a
 * BECAUSE naming a precondition that had to be settled before development
 * began; first-word extraction recorded that as an unqualified "proceed" and the
 * framing counted the role among the plain proceeds. Both available answers were
 * worse than this one: discarding the role loses a real position and can empty an
 * inbox on a run that genuinely conflicts, and silently flattening it reports a
 * plainer position than the role took. Keeping the qualifier does neither.
 *
 * A punctuation tail is not a qualifier. "proceed.", "proceed --" and "hold!"
 * are the same declaration as the bare word, so the tail is stripped and the
 * qualifier stays null; only surviving word characters qualify a stance.
 */
export function parseStance(text: unknown): DeclaredStance | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const lines = text.split('\n').map(undecorate).filter(Boolean);

  const raw = labeled(lines, 'stance');
  if (raw === null) return null;
  const match = /^([a-z-]+)([\s\S]*)$/i.exec(raw);
  const word = match?.[1]?.toLowerCase();
  if (!word || !(STANCES as readonly string[]).includes(word)) return null;

  // Strip a leading separator and any trailing punctuation, then require a real
  // word to remain — otherwise the "qualifier" was only decoration.
  const tail = (match?.[2] ?? '')
    .replace(/^[\s:;,.!?—–-]+/, '')
    .replace(/[\s.,;:!?—–-]+$/, '')
    .trim();
  const qualifier = /\w/.test(tail) ? tail : null;

  const because = labeled(lines, 'because');
  return {
    stance: word as Stance,
    qualifier,
    because: because && because.trim() ? because.trim() : null,
    citation: citationOrNull(labeled(lines, 'cite')),
  };
}

export interface RoleStance {
  readonly role: string;
  readonly declared: DeclaredStance;
}

/**
 * Whether these roles actually disagree. One side saying hold while another
 * says proceed is a conflict; everything else is a report, and a report does
 * not belong in the inbox (commitment 2).
 */
export function isConflict(stances: readonly RoleStance[]): boolean {
  const taken = new Set(stances.map((s) => s.declared.stance));
  return taken.has('hold') && taken.has('proceed');
}

export interface FrameInput {
  readonly run: string;
  readonly outcome: string;
  readonly stances: readonly RoleStance[];
  /** Injected; the kernel never reads the clock. */
  readonly at: string;
}

/**
 * Frame a cross-domain conflict as one decision, or null when there is nothing
 * for the user to decide.
 *
 * Positions are ordered by role name and nothing marks one as recommended.
 * That is the whole point: an order that meant anything would be the hidden
 * precedence commitment 11 forbids, and a recommendation would be the
 * arbitration it forbids twice over. Roles that declared `unclear` are left out
 * — they are not a side, and padding the framing with them would make the
 * disagreement look broader than it is.
 *
 * The tally counts roles under the stance they actually wrote, so a qualified
 * stance is never folded into the plain one. Note that this
 * changes what the question SAYS, not which runs raise a decision: isConflict
 * still reads the declared word, so carrying qualifiers invents no conflict and
 * loses none.
 */
/**
 * A stance label short enough to read inside a count.
 *
 * The question line is a tally, and a tally is unreadable the moment one of its
 * names is a sentence. Cut on a word boundary so the fragment is a phrase
 * rather than a severed word, and mark that it was cut, because a qualifier
 * silently shortened is a role quoted as saying something narrower than it did.
 * The uncut text is on the position.
 */
const LABEL_BUDGET = 40;

export function shortLabel(label: string): string {
  if (label.length <= LABEL_BUDGET) return label;
  const cut = label.slice(0, LABEL_BUDGET);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).replace(/[,;:]$/, '')}…`;
}

export function frameConflict(input: FrameInput): RaiseDecision | null {
  const sides = input.stances.filter((s) => s.declared.stance !== 'unclear');
  if (!isConflict(sides)) return null;

  // Grouped by what each role wrote, holds first so the question opens on the
  // objection, then in declaration order — not by size, which would read as a
  // verdict on which side is winning.
  // Keyed on the full label, shown short. Collapsing to the bare stance word
  // was tried and is wrong: a role that wrote "proceed with conditions" counted
  // among the plain proceeds is reported as plainer than it wrote, which is the
  // one thing this framing may never do. What was actually broken is the
  // reading — a role ending with a forty-word caveat had the whole caveat read
  // out inside the count, as though it were the name of a side. So the sides
  // stay exactly as distinct as the roles made them and only the rendering is
  // bounded; the qualifier in full travels on the position, beside the reason,
  // which is where a reader who wants it is already looking.
  const tally = new Map<string, number>();
  for (const side of sides) {
    const label = stanceLabel(side.declared);
    tally.set(label, (tally.get(label) ?? 0) + 1);
  }
  const counted = [...tally.entries()]
    .sort(([a], [b]) => Number(b.startsWith('hold')) - Number(a.startsWith('hold')))
    .map(([label, n], i) =>
      i === 0 ? `${String(n)} role(s) say ${shortLabel(label)}` : `${String(n)} say ${shortLabel(label)}`,
    )
    .join(', ');

  const positions: Position[] = [...sides]
    .sort((a, b) => a.role.localeCompare(b.role))
    .map((s) => ({
      role: s.role,
      stance: s.declared.because
        ? `${stanceLabel(s.declared)} — ${s.declared.because}`
        : stanceLabel(s.declared),
      citation: s.declared.citation,
    }));

  // The reversible default, stated as its own position rather than left to the
  // reader to work out.
  //
  // Commitment 11 as amended says every inbox decision ships as a risk
  // assessment: what fired, the stakes on each branch, and the branch that
  // holds if the user does nothing. The ask path has carried that default
  // since it was written; this path never did — it named the sides and
  // stopped, which hands the user back the same work they were delegating.
  //
  // The default is holding, and it is not an arbitration. It is the branch
  // that is actually reversible: an outcome not yet proceeded with can still
  // proceed tomorrow, and one proceeded with cannot be unproceeded. Saying so
  // is the opposite of picking a winner — it tells the user what silence
  // costs, which is the only way silence can be a choice rather than an
  // accident. The holding roles are named because the default is theirs, and a
  // default with no author reads as the tool's own recommendation.
  const holding = sides
    .filter((s) => s.declared.stance === 'hold')
    .map((s) => s.role)
    .sort();
  const proceeding = sides
    .filter((s) => s.declared.stance === 'proceed')
    .map((s) => s.role)
    .sort();
  positions.push({
    role: 'construct',
    stance:
      'the reversible default if you do nothing: this holds, because holding ' +
      'can be undone tomorrow and proceeding cannot. That is what silence ' +
      `costs, not a preference — ${holding.join(' and ')} argued for it, ` +
      `${proceeding.join(' and ')} argued against, and the call is yours`,
    citation: null,
  });

  return {
    id: `${input.run}:stance`,
    run: input.run,
    // What fired, then the call. A question that opens on the disagreement
    // without naming the pattern that produced it is an alert wearing a
    // question mark.
    question:
      `Two concerns disagree on this outcome: ${input.outcome} — ${counted}. ` +
      'This one is yours to call.',
    positions,
    raisedAt: input.at,
  };
}
