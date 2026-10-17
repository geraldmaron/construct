import { closed, str } from '../definition.ts';
import { getDecision } from '../../state/decisions.ts';
import { getStatement, getProfile, missingProfileFields } from '../../state/profile.ts';
import { resolveProposal, onboardingQuestionOf } from '../../project/onboarding.ts';
import { PersonChannelRequiredError, personStepFor } from '../../policy/channels.ts';
import { quoteHost } from '../../render/person-prompt.ts';
import { type PromotionSubject } from '../../workflow/service.ts';
import { define, PERSON_ASKED_ONLY, askThePerson } from './shared.ts';
import { followUp } from './sources.ts';

export const decide = define<{ decisionId: string; resolution: string | string[] }, unknown>({
  name: 'decide',
  title: 'Relay the person’s decision',
  description: [
    'Record the answer the person gave to an open decision, in their words or as one of its options; an approval covers exactly the action asked about and expires. Answers only the person can give (an external or destructive action, accepting a deliverable, making the project a side project, or a replacement, ruled-out term or outdated document) are put to them directly when the host can, and otherwise stay open with how to answer.',
    PERSON_ASKED_ONLY,
  ].join(' '),
  surface: 'interactive',
  readOnly: false,
  destructive: true,
  inputSchema: {
    type: 'object',
    properties: {
      decisionId: { type: 'string', description: 'From inbox.' },
      resolution: { type: 'string', description: 'The person’s answer, or one of the options.' },
    },
    required: ['decisionId', 'resolution'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { decisionId: str(raw, 'decisionId')!, resolution: str(raw, 'resolution')! };
  },
  async run(ctx, { decisionId, resolution }) {
    // Whatever arrives here was relayed by the model in the host, so it is
    // recorded as relayed through that host, never as the person.
    const by = `relayed via ${ctx.host.hostId}`;
    const existing = getDecision(ctx.store, decisionId);
    const proposed = existing ? null : getStatement(ctx.store, decisionId);
    if (proposed?.status === 'proposed') {
      const answer = Array.isArray(resolution) ? resolution.join(' ') : resolution;
      const statement = resolveProposal(ctx.store, {
        id: decisionId,
        resolution: answer,
        at: ctx.now(),
        nextId: ctx.nextId,
        by,
        channel: 'relay',
      });
      return {
        decision: { id: statement.id, state: statement.status, resolvedBy: by },
        run: null,
        statement: { id: statement.id, kind: statement.kind, status: statement.status },
      };
    }
    // A setup question's answer lands in the profile; the reply says what setup still needs.
    const setup = (): Record<string, unknown> => {
      if (onboardingQuestionOf(existing?.subject) === null) return {};
      const profile = getProfile(ctx.store);
      return { profile: { onboarding: profile?.onboardingState ?? 'incomplete', missing: missingProfileFields(profile) } };
    };
    try {
      const r = ctx.workflow.decide({ decisionId, resolution, by, channel: 'relay' });
      return {
        decision: { id: r.decision.id, state: r.decision.state, resolvedBy: r.decision.resolvedBy },
        run: r.run ? { id: r.run.id, state: r.run.state } : null,
        ...followUp(ctx, existing, String(resolution)),
        ...setup(),
      };
    } catch (error) {
      if (!(error instanceof PersonChannelRequiredError)) throw error;
      const relayed = `Your assistant relayed ${quoteHost(Array.isArray(resolution) ? resolution.join(' ') : resolution)}.`;
      // Accepting a deliverable is asked about the deliverable as it stands now: a question put before it changed is withdrawn and asked again.
      const promote = existing?.kind === 'approval' ? (existing.subject as { promote?: PromotionSubject } | null)?.promote : undefined;
      const current = promote
        ? ctx.workflow.requestPromotion({
            deliverableId: promote.deliverableId,
            to: promote.to,
            by: ctx.actor,
            reason: promote.reason ?? undefined,
          })
        : null;
      const askedId = current?.id ?? decisionId;
      const replaced = askedId !== decisionId ? { replaces: decisionId } : {};
      const asked = await askThePerson(ctx, askedId, relayed, error.answer);
      if (asked) return { ...asked, ...replaced, ...setup() };
      return {
        decision: { id: askedId, state: 'open' },
        ...replaced,
        personRequired: true,
        next: current ? personStepFor(askedId) : error.message,
        ...setup(),
      };
    }
  },
});
