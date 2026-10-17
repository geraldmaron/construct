import { closed, str, obj, bool } from '../definition.ts';
import { getStep, heldLease } from '../../state/steps.ts';
import { settleManagedDelivery } from '../managed-delivery.ts';
import { provenanceOf } from '../../project/evidence.ts';
import { define, leaseToken, projectResolver } from './shared.ts';
import { CITATION_ITEM, citationsInput } from './citations.ts';

interface SubmitInput {
  stepRunId: string;
  token: string;
  output: Record<string, unknown>;
  evidence: { ref: string; excerpt?: string }[];
  noData: boolean;
}

export const submitWork = define<SubmitInput, unknown>({
  name: 'submit_work',
  title: 'Submit a step’s result',
  description:
    "Hand back what a claimed step produced, with the evidence you read; the step's validators check it, and a failure comes back with what to fix and a retry when its policy allows. Say noData when the step found nothing.",
  surface: 'both',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      stepRunId: { type: 'string', description: 'From claim_work.' },
      token: { type: 'string', description: 'From claim_work: the lease’s secret.' },
      output: { type: 'object', description: 'The step’s result, with the keys it declared.' },
      evidence: { type: 'array', description: 'What was read: {ref, excerpt?} entries.', items: CITATION_ITEM },
      noData: { type: 'boolean', description: 'The step found nothing to work on.' },
    },
    required: ['stepRunId', 'token', 'output'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    const evidence = citationsInput(raw, 'evidence');
    return {
      stepRunId: str(raw, 'stepRunId')!,
      token: leaseToken(raw),
      output: obj(raw, 'output')!,
      evidence,
      noData: bool(raw, 'noData', false),
    };
  },
  run(ctx, input) {
    if (!getStep(ctx.store, input.stepRunId)) throw new Error(`no step ${input.stepRunId}`);
    const leased = heldLease(ctx.store, { id: input.stepRunId, owner: ctx.host.executorId, nonce: input.token });
    if (!leased) throw new Error(`step ${input.stepRunId} is not held by this session under that token; claim it again`);
    const resolve = projectResolver(ctx);
    const r = ctx.store.transaction(() => {
      const result = ctx.workflow.submit({ leased, output: input.output, evidence: input.evidence, noData: input.noData, resolve });
      settleManagedDelivery(ctx, result.run.id, result.run.state);
      return result;
    });
    return {
      step: { id: r.step.id, state: r.step.state, reason: r.step.stateReason },
      validation: r.validation,
      ...(r.semanticReview ? { semanticReview: r.semanticReview } : {}),
      // How much of this step rests on what Construct opened itself versus what the host reports it read.
      evidence: provenanceOf(input.evidence, resolve),
      run: { id: r.run.id, state: r.run.state },
      deliverable: r.deliverable
        ? { id: r.deliverable.id, trust: r.deliverable.trustState, verification: r.deliverable.verification }
        : null,
      // Restated keys whose value differs from what the step was handed: the deliverable carries what was handed.
      ...(r.ignored.length > 0 ? { ignored: r.ignored } : {}),
    };
  },
});
