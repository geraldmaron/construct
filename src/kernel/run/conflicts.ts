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
  /** The role's one-line reason, or null if it declared none. */
  readonly because: string | null;
  /** What it says it is relying on, or null when it cited nothing. */
  readonly citation: string | null;
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
 */
function undecorate(line: string): string {
  return line
    .replace(/[*_`>#]/g, '')
    .replace(/^\s*[-+•]\s*/, '')
    .trim();
}

function labeled(lines: readonly string[], label: string): string | null {
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
 * wrapped them in. Anything else — a missing block, a fourth word, a sentence
 * where the stance should be — reads as "no stance declared", which is the
 * safe answer because it removes the role from the framing rather than putting
 * a position in its mouth.
 */
export function parseStance(text: unknown): DeclaredStance | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const lines = text.split('\n').map(undecorate).filter(Boolean);

  const raw = labeled(lines, 'stance');
  if (raw === null) return null;
  const word = /^([a-z-]+)/i.exec(raw)?.[1]?.toLowerCase();
  if (!word || !(STANCES as readonly string[]).includes(word)) return null;

  const because = labeled(lines, 'because');
  return {
    stance: word as Stance,
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
 */
export function frameConflict(input: FrameInput): RaiseDecision | null {
  const sides = input.stances.filter((s) => s.declared.stance !== 'unclear');
  if (!isConflict(sides)) return null;

  const holding = sides.filter((s) => s.declared.stance === 'hold').length;
  const proceeding = sides.length - holding;

  const positions: Position[] = [...sides]
    .sort((a, b) => a.role.localeCompare(b.role))
    .map((s) => ({
      role: s.role,
      stance: s.declared.because
        ? `${s.declared.stance} — ${s.declared.because}`
        : s.declared.stance,
      citation: s.declared.citation,
    }));

  return {
    id: `${input.run}:stance`,
    run: input.run,
    question:
      `${input.outcome} — ${String(holding)} role(s) say hold, ` +
      `${String(proceeding)} say proceed. This one is yours to call.`,
    positions,
    raisedAt: input.at,
  };
}
