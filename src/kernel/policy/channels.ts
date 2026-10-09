/**
 * kernel/policy/channels.ts — how an answer reached Construct, and which
 * answers only the person may give.
 *
 * A model relaying the person's words is a relay. A relay may answer a
 * question, decline an action, or approve work that stays inside the project,
 * but it cannot approve an action that leaves the project or destroys
 * something, and it cannot move a deliverable to accepted or final. Those need
 * a channel on which the person answers Construct directly: a terminal the
 * person is typing in, an elicitation the host shows them, or a confirmation
 * prompt the host is verified to show. Text a model retrieved or was told can
 * never stand in for that.
 */

import type { ActionTier } from '../state/steps.ts';
import type { TrustState } from '../state/deliverables.ts';

export const DECISION_CHANNELS = ['relay', 'tty_cli', 'elicitation', 'host_prompted'] as const;
export type DecisionChannel = (typeof DECISION_CHANNELS)[number];

const PERSON_CHANNELS: ReadonlySet<DecisionChannel> = new Set(['tty_cli', 'elicitation', 'host_prompted']);

/** Tiers whose approval only the person may give. */
export const PERSON_ONLY_TIERS: ReadonlySet<ActionTier> = new Set<ActionTier>(['external_write', 'destructive']);

/** Trust states a deliverable reaches only on the person's own word. */
export const PERSON_ONLY_TRUST: ReadonlySet<TrustState> = new Set<TrustState>(['accepted', 'final']);

export function isPersonChannel(channel: DecisionChannel): boolean {
  return PERSON_CHANNELS.has(channel);
}

/**
 * The instruction a relay gets back: who must answer, and exactly how. The
 * answer is the one the relay asked for; without one, the person approves or
 * declines.
 */
export function personStepFor(decisionId: string | null, answer: string | null = null): string {
  if (!decisionId) return 'The person gives this answer directly, in their own terminal with `construct inbox`. A model relaying their words cannot give it.';
  const command = answer === null ? `\`construct inbox resolve ${decisionId} approve\` (or decline)` : `\`construct inbox resolve ${decisionId} ${answer}\``;
  return `The person answers this directly: they run ${command} in their own terminal. A model relaying their words cannot give this answer.`;
}

export class PersonChannelRequiredError extends Error {
  readonly decisionId: string | null;
  /** The answer the relay gave, as the person would type it; null for an approval. */
  readonly answer: string | null;

  constructor(what: string, decisionId: string | null, answer: string | null = null) {
    super(`${what} needs the person. ${personStepFor(decisionId, answer)}`);
    this.name = 'PersonChannelRequiredError';
    this.decisionId = decisionId;
    this.answer = answer;
  }
}

/** A question put to the person directly, through the host, with the answers they may give. */
export interface PersonQuestion {
  readonly message: string;
  readonly options: readonly string[];
}

/** What came back: the person's choice, or why there is none. */
export type PersonAnswer =
  | { readonly answered: true; readonly choice: string }
  | { readonly answered: false; readonly why: 'declined' | 'cancelled' | 'timeout' | 'unavailable' };

/**
 * Ask the person directly, bypassing the model. Supplied by a host adapter
 * only when the host shows the question to the person and nothing on this
 * machine is configured to answer it for them.
 */
export type AskPerson = (question: PersonQuestion) => Promise<PersonAnswer>;
