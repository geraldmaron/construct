import { closed, str } from '../definition.ts';
import { recoverAbandonedSteps, reserveManagedDelivery } from '../managed-delivery.ts';
import { define } from './shared.ts';

export const claimStep = define<{ runId?: string }, unknown>({
  name: 'claim_step',
  title: 'Claim a pre-resolved step',
  description:
    'A configured runner takes the next ready step of a run that was already resolved and gated. Returns the step, inputs, bound skill, and instructions, or what the run waits on. A step above this runner’s tier or beyond its capabilities is refused, with why.',
  surface: 'headless',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: { runId: { type: 'string', description: 'A run id; omit for any active run.' } },
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { runId: str(raw, 'runId', { optional: true }) };
  },
  run(ctx, { runId }) {
    recoverAbandonedSteps(ctx, runId);
    const { c, delivery } = ctx.store.transaction(() => {
      const c = ctx.workflow.claimNext({ runId, owner: ctx.host.executorId });
      return { c, delivery: c.packet ? reserveManagedDelivery(ctx, c.packet) : null };
    });
    if (!c.packet) return { work: null, waitingOn: c.waitingOn };
    const p = c.packet;
    return {
      work: {
        semanticReview: p.semanticReview,
        stepRunId: p.leased.id,
        token: p.leased.nonce,
        leaseUntil: p.leased.leaseUntil,
        run: { id: p.run.id, workflow: p.run.workflowId },
        step: { id: p.step.id, title: p.step.title, tier: p.step.tier, outputs: p.step.outputs, validators: p.step.validators },
        skill: p.skill ? { id: p.skill.id, version: p.skill.version, body: p.skill.body() } : null,
        inputs: p.inputs,
        intake: p.intake,
        method: p.method,
        methodCatalog: p.methodCatalog.map(({ id, title }) => ({ id, title })),
        delivery,
        instructions: p.instructions,
      },
      waitingOn: null,
    };
  },
});
