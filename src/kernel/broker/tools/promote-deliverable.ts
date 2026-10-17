import { TRUST_STATES, type TrustState, getDeliverable } from '../../state/deliverables.ts';
import { type Objection, OBJECTION_DISPOSITIONS, VALIDATED_BY_CHECKS, OBJECTIONS_EXAMPLE, readObjections } from '../../workflow/service.ts';
import { closed, ToolInputError, str } from '../definition.ts';
import { PERSON_ONLY_TRUST, personStepFor } from '../../policy/channels.ts';
import { define, askThePerson } from './shared.ts';

/** The trust states promote_deliverable moves a deliverable to: validated is set only by a step's passing checks. */
const PROMOTABLE = TRUST_STATES.filter((t) => t !== 'validated');

export const promote = define<{ deliverableId: string; to: TrustState; reason?: string; objections?: readonly Objection[] }, unknown>({
  name: 'promote_deliverable',
  title: 'Move a deliverable’s trust',
  description:
    "After the person has reviewed a deliverable, record a challenge with its objections, or ask them to accept it or make it final. Accepted and final are the person's own answer, asked directly when the host can; validated comes only from passing checks.",
  surface: 'interactive',
  readOnly: false,
  destructive: true,
  inputSchema: {
    type: 'object',
    properties: {
      deliverableId: { type: 'string', description: 'The deliverable id.' },
      to: { type: 'string', description: 'The trust state to move to.', enum: PROMOTABLE },
      reason: { type: 'string', description: 'Why, in the person’s words.' },
      objections: {
        type: 'array',
        description:
          'For challenged: each objection the challenge raised and what was done about it (fixed, accepted, rejected, open); an empty list says it found nothing.',
        items: {
          type: 'object',
          properties: {
            objection: { type: 'string', description: 'What the challenge objected to.' },
            disposition: { type: 'string', description: 'What was done about it.', enum: OBJECTION_DISPOSITIONS },
          },
          required: ['objection', 'disposition'],
          additionalProperties: false,
        },
      },
    },
    required: ['deliverableId', 'to'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    if (raw.to === 'validated')
      throw new ToolInputError(`${VALIDATED_BY_CHECKS}; move it to challenged, accepted, or another state`, {
        field: 'to',
        allowed: PROMOTABLE,
      });
    const to = str(raw, 'to', { oneOf: PROMOTABLE }) as TrustState;
    const given = { deliverableId: str(raw, 'deliverableId')!, to, reason: str(raw, 'reason', { optional: true }) };
    if (to !== 'challenged') {
      if (raw.objections !== undefined) throw new ToolInputError('"objections" is only for to: challenged', { field: 'objections' });
      return given;
    }
    if (raw.objections === undefined || raw.objections === null) {
      throw new ToolInputError(
        '"objections" is required for challenged: each objection the challenge raised and what was done about it; an empty list says it found nothing',
        { field: 'objections', example: OBJECTIONS_EXAMPLE },
      );
    }
    const read = readObjections(raw.objections);
    if (!('objections' in read)) {
      const one = OBJECTIONS_EXAMPLE[0]!;
      const example = read.field.endsWith('.disposition')
        ? one.disposition
        : read.field.endsWith('.objection')
          ? one.objection
          : read.field === 'objections'
            ? OBJECTIONS_EXAMPLE
            : one;
      throw new ToolInputError(read.message, { field: read.field, ...(read.allowed ? { allowed: read.allowed } : {}), example });
    }
    return { ...given, objections: read.objections };
  },
  async run(ctx, { deliverableId, to, reason, objections }) {
    if (PERSON_ONLY_TRUST.has(to)) {
      const pending = ctx.workflow.requestPromotion({ deliverableId, to, by: ctx.actor, reason });
      const asked = await askThePerson(ctx, pending.id, null);
      if (asked && (asked.decision as { state: string }).state !== 'open') {
        const d = getDeliverable(ctx.store, deliverableId);
        return { ...asked, deliverable: { id: deliverableId, trust: d?.trustState ?? 'unchanged' } };
      }
      return {
        deliverable: { id: deliverableId, trust: 'unchanged' },
        pendingDecision: pending.id,
        personRequired: true,
        ...(asked ? { asked: asked.asked } : {}),
        next: personStepFor(pending.id),
      };
    }
    const verification = to === 'challenged' ? { challenge: { objections: objections ?? [] } } : undefined;
    const d = ctx.workflow.promote({ deliverableId, to, by: ctx.actor, channel: 'relay', reason, verification });
    return { deliverable: { id: d.id, trust: d.trustState } };
  },
});
