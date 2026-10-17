import { closed, str, bool } from '../definition.ts';
import { recoverAbandonedSteps, settleManagedDelivery, reserveManagedDelivery, DeliveryRecoveryRequired } from '../managed-delivery.ts';
import { getRun } from '../../state/runs.ts';
import { define } from './shared.ts';

export const claimWork = define<{ runId?: string; includeSkillBody: boolean }, unknown>({
  name: 'claim_work',
  title: 'Claim the next step',
  description:
    'Take the next ready step of a run to do in this session. Returns the step, its inputs, bound skill, compact method index and instructions. For a requested local artifact, delivery includes its existing native work/path reservation and held draft: use that reservation instead of creating another commitment or work claim. Only the current step tier authorizes writing. If the run is waiting on a decision, returns that decision instead so you can surface it. A step the person approved for another session is held for it, and a step beyond what this session may do is refused; either comes back with who or why. A blocked run comes back with its reasons and what would unblock it.',
  surface: 'interactive',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      runId: { type: 'string', description: 'A run id; omit to take from any active run.' },
      includeSkillBody: {
        type: 'boolean',
        description: 'Include the bound skill’s full text (default true); false requests metadata only.',
      },
    },
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { runId: str(raw, 'runId', { optional: true }), includeSkillBody: bool(raw, 'includeSkillBody', true) };
  },
  run(ctx, { runId, includeSkillBody }) {
    recoverAbandonedSteps(ctx, runId);
    const result = (() => {
      try {
        return ctx.store.transaction(() => {
          const c = ctx.workflow.claimNext({ runId, owner: ctx.host.executorId });
          const settledRunId = runId ?? (c.waitingOn?.kind === 're_resolve' ? c.waitingOn.runId : undefined);
          if (!c.packet && settledRunId) {
            const run = getRun(ctx.store, settledRunId);
            if (run) settleManagedDelivery(ctx, run.id, run.state);
          }
          return { c, delivery: c.packet ? reserveManagedDelivery(ctx, c.packet) : null };
        });
      } catch (error) {
        if (error instanceof DeliveryRecoveryRequired) return { recovery: error.recovery };
        throw error;
      }
    })();
    if ('recovery' in result) return { work: null, waitingOn: result.recovery };
    const { c, delivery } = result;
    if (!c.packet) return { work: null, waitingOn: c.waitingOn };
    const p = c.packet;
    return {
      work: {
        semanticReview: p.semanticReview,
        delivery,
        stepRunId: p.leased.id,
        token: p.leased.nonce,
        leaseUntil: p.leased.leaseUntil,
        run: { id: p.run.id, workflow: p.run.workflowId },
        step: {
          id: p.step.id,
          title: p.step.title,
          tier: p.step.tier,
          outputs: p.step.outputs,
          validators: p.step.validators,
          capabilities: p.step.capabilities,
        },
        skill: p.skill
          ? { id: p.skill.id, version: p.skill.version, digest: p.skill.digest, body: includeSkillBody ? p.skill.body() : undefined }
          : null,
        inputs: p.inputs,
        intake: p.intake,
        method: p.method,
        methodCatalog: p.methodCatalog.map(({ id, title }) => ({ id, title })),
        methodCatalogDetail: "Compact index; skills list/show provides each skill's description and method resources.",
        instructions: p.instructions,
        judgment: p.judgment,
      },
      waitingOn: null,
    };
  },
});
