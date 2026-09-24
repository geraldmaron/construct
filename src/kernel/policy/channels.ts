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

/** The instruction a relay gets back: who must answer, and exactly how. */
export function personStepFor(decisionId: string | null): string {
  return decisionId
    ? `The person answers this directly: they run \`construct inbox resolve ${decisionId} approve\` (or decline) in their own terminal. A model relaying their words cannot give this answer.`
    : 'The person gives this answer directly, in their own terminal with `construct inbox`. A model relaying their words cannot give it.';
}

export class PersonChannelRequiredError extends Error {
  readonly decisionId: string | null;

  constructor(what: string, decisionId: string | null) {
    super(`${what} needs the person. ${personStepFor(decisionId)}`);
    this.name = 'PersonChannelRequiredError';
    this.decisionId = decisionId;
  }
}
