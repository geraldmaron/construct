/**
 * kernel/run/asks.ts — a role that lacks a fact asks for it through the inbox
 * instead of only assuming.
 *
 * Operating as a team member means knowing when to gather a requirement before
 * executing on it. The dispatch stays fail-open: the deliverable ships on a
 * stated assumption whether or not anyone answers, so an ask qualifies the
 * work, it never blocks it. The role declares the ask in a fixed shape and the
 * kernel turns it into the decision (commitment 14 — a role never writes the
 * inbox itself), framed the way every inbox decision is framed: what was
 * asked, and the reversible default that stands if the user does nothing.
 *
 * The anti-nagging rule is structural, not advisory: one ask per deliverable
 * is parsed, and a run carries at most one open ask at a time. Asking is for
 * facts that change the work; coverage for a role's own uncertainty belongs
 * in its open-questions slot, and the protocol says so to the role.
 */

import { labeled, parseStakes, undecorate } from './conflicts.ts';
import { renderJudgment } from './estimative.ts';
import type { EstimativeJudgment } from './estimative.ts';
import type { Position, RaiseDecision } from '../store/decisions.ts';
import { openDecisions, resolvedDecisions } from '../store/decisions.ts';
import type { Store } from '../store/open.ts';

/** The two lines a role adds when a user-held fact would change the work. */
export const ASK_PROTOCOL = [
  'If one fact only the user can supply would materially change this work,',
  'add two lines after your stance block, exactly:',
  'ASK: <the question, one sentence>',
  'ASSUMING: <the reversible default you proceeded on>',
  '',
  'At most one ASK. Never withhold or thin the deliverable because the',
  'question is unanswered — deliver the work your stated assumption allows.',
  'Do not ask for coverage of your own uncertainty; that belongs in',
  'open-questions. Ask only when the answer would change what you produced.',
].join('\n');

export interface DeclaredAsk {
  readonly question: string;
  readonly assuming: string;
  /**
   * What the role says riding on the assumption, as a likelihood with its
   * separate confidence, or the rung below when its basis is too thin. Null
   * when it declared none: an ask still ships without one, since the
   * reversible default is what makes silence safe, not the estimate.
   */
  readonly stakes: EstimativeJudgment | null;
}

/**
 * The ask a deliverable declared, or null. Both lines are required: a question
 * with no stated default is a blocked deliverable wearing a question mark, and
 * that is exactly the shape this protocol refuses to create.
 */
export function parseAsk(text: unknown): DeclaredAsk | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const lines = text.split('\n').map(undecorate).filter(Boolean);
  const question = labeled(lines, 'ask');
  const assuming = labeled(lines, 'assuming');
  if (!question || !question.trim() || !assuming || !assuming.trim()) return null;
  return { question: question.trim(), assuming: assuming.trim(), stakes: parseStakes(text) };
}

export interface FrameAskInput {
  readonly run: string;
  readonly task: string;
  readonly role: string;
  readonly ask: DeclaredAsk;
  /** Injected; the kernel never reads the clock. */
  readonly at: string;
}

/**
 * One ask as one inbox decision. Two positions because the store requires the
 * decision to carry both sides, and an ask genuinely has both: the role's
 * question, and the default that stands unanswered. The default is the
 * risk-assessment half every inbox decision owes the user — doing nothing is
 * always a safe, named choice.
 */
export function frameAsk(input: FrameAskInput): RaiseDecision {
  const positions: Position[] = [
    { role: input.role, stance: `asks: ${input.ask.question}`, citation: null },
    {
      role: 'construct',
      stance:
        `the reversible default if you do nothing: ${input.ask.assuming} — ` +
        'the deliverable already proceeds on it' +
        // What is riding on the assumption, where the role said. A default
        // whose consequence is stated is a choice the user can weigh; one
        // stated bare asks them to guess what silence costs.
        (input.ask.stakes ? `. ${renderJudgment(input.ask.stakes)}` : ''),
      citation: null,
    },
  ];
  return {
    id: `${input.task}:ask`,
    run: input.run,
    question: `The ${input.role} role needs a fact only you can give: ${input.ask.question}`,
    positions,
    raisedAt: input.at,
  };
}

/**
 * An ask is an inbox decision raised under this suffix, and nothing else is.
 * Every reader of the inbox that needs to tell the two apart asks here, so the
 * convention is written down once instead of in each surface that reads it.
 */
export function isAsk(decisionId: string): boolean {
  return decisionId.endsWith(':ask');
}

export interface OpenAsk {
  readonly id: string;
  readonly run: string;
  readonly role: string;
  readonly question: string;
  /**
   * The reversible default already carrying the work, in the words the inbox
   * holds. Null only if the decision was written without one.
   */
  readonly standingDefault: string | null;
  readonly raisedAt: string;
}

/**
 * The asks waiting on the user, oldest first, optionally scoped to one run.
 *
 * The default travels with the question because the two only mean anything
 * together: a surface that showed the question alone would make silence look
 * like a stalled deliverable, and the whole point of the protocol is that the
 * work already shipped on the stated assumption.
 */
export function openAsksFor(store: Store, run?: string): OpenAsk[] {
  return openDecisions(store, run)
    .filter((decision) => isAsk(decision.id))
    .map((decision) => ({
      id: decision.id,
      run: decision.run,
      role: decision.positions[0]?.role ?? 'unknown',
      question: decision.question,
      standingDefault:
        decision.positions.find((position) => position.role === 'construct')?.stance ?? null,
      raisedAt: decision.raisedAt,
    }));
}

export interface AnsweredAsk {
  readonly role: string;
  readonly question: string;
  readonly answer: string;
}

/**
 * The asks the user has answered for this run, in the order they were
 * resolved. Later dispatches of the run receive these as settled decisions —
 * an answer given once is never asked for again, and never silently dropped.
 */
export function answeredAsksFor(store: Store, run: string): AnsweredAsk[] {
  return resolvedDecisions(store, run)
    .filter((decision) => isAsk(decision.id) && decision.resolution !== null)
    .map((decision) => ({
      role: decision.positions[0]?.role ?? 'unknown',
      question: decision.question,
      answer: decision.resolution ?? '',
    }));
}
