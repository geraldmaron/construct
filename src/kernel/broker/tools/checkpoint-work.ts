import { closed, str, list, num, ToolInputError } from '../definition.ts';
import { getStep, heldLease } from '../../state/steps.ts';
import { getRun } from '../../state/runs.ts';
import { contentReceipt } from '../../workflow/verification.ts';
import { isInside } from '../../safety/containment.ts';
import { redact } from '../../render/redact.ts';
import { appendActivity } from '../../state/activity.ts';
import { define, leaseToken, projectResolver } from './shared.ts';

export const checkpointWork = define<
  { stepRunId: string; token: string; summary: string; artifact?: string; unknowns: string[]; remaining: string[]; gatherCalls: number },
  unknown
>({
  name: 'checkpoint_work',
  title: 'Preserve work in progress',
  surface: 'both',
  readOnly: false,
  description:
    'Save a durable partial result on your current step lease before gathering or repairs exhaust their budget; it neither completes the step nor verifies it. Files must already exist and be permitted by the step.',
  inputSchema: {
    type: 'object',
    properties: {
      stepRunId: { type: 'string', description: 'Current claimed step.' },
      token: { type: 'string', description: 'Current lease token.' },
      summary: { type: 'string', description: 'Useful progress so far.' },
      artifact: { type: 'string', description: 'Existing authorized project artifact, when any.' },
      unknowns: { type: 'array', description: 'Missing evidence and unresolved facts.', items: { type: 'string' } },
      remaining: { type: 'array', description: 'Next actions without repeating completed effects.', items: { type: 'string' } },
      gatherCalls: { type: 'number', description: 'Host-reported gathering calls so far; no execution proof.' },
    },
    required: ['stepRunId', 'token', 'summary'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return {
      stepRunId: str(raw, 'stepRunId')!,
      token: leaseToken(raw),
      summary: str(raw, 'summary')!,
      artifact: str(raw, 'artifact', { optional: true }),
      unknowns: list(raw, 'unknowns') as string[],
      remaining: list(raw, 'remaining') as string[],
      gatherCalls: num(raw, 'gatherCalls') ?? 0,
    };
  },
  run(ctx, input) {
    const step = getStep(ctx.store, input.stepRunId);
    const at = ctx.now();
    const lease = step?.leaseOwner ? heldLease(ctx.store, { id: step.id, owner: ctx.host.executorId, nonce: input.token }) : null;
    if (!step || !lease || lease.leaseUntil <= at) throw new Error('Checkpoint requires this session’s current unexpired step lease');
    if (
      JSON.stringify(input).length > 20_000 ||
      !Number.isSafeInteger(input.gatherCalls) ||
      input.gatherCalls < 0 ||
      [...input.unknowns, ...input.remaining].some((s) => typeof s !== 'string')
    )
      throw new ToolInputError('Checkpoint must contain bounded text and a nonnegative gather-call count');
    const run = getRun(ctx.store, step.runId)!;
    if (run.cancelRequested || ['failed', 'cancelled', 'succeeded'].includes(run.state))
      throw new Error('Stopped outcomes cannot receive a new checkpoint');
    const artifact = input.artifact ? projectResolver(ctx)(input.artifact, 'artifact') : null;
    const receipt = input.artifact ? contentReceipt(input.artifact, projectResolver(ctx), 'artifact') : null;
    const binding = run.bindings as {
      steps?: readonly import('../../registry/models.ts').WorkflowStep[];
      execution?: import('../../registry/models.ts').WorkflowManifest['execution'];
    } | null;
    const bound = binding?.steps?.find((s) => s.id === step.stepId);
    if (
      input.artifact &&
      (artifact?.kind !== 'file' ||
        !artifact.path ||
        !isInside(ctx.root, artifact.path) ||
        !receipt?.digest ||
        bound?.tier !== 'project_write')
    )
      throw new Error('Artifact checkpoint needs an existing readable artifact on a project-write step');
    const payload = {
      summary: redact(input.summary),
      artifact: receipt,
      unknowns: input.unknowns.map(redact),
      remaining: input.remaining.map(redact),
      gathering: {
        calls: input.gatherCalls,
        provenance: 'host_reported',
        limit: binding?.execution?.maxGatherCalls ?? null,
        exhausted: binding?.execution ? input.gatherCalls >= binding.execution.maxGatherCalls : false,
      },
      assurance: 'partial_unverified',
    };
    const event = appendActivity(ctx.store, {
      at,
      kind: 'step.checkpoint',
      runId: run.id,
      stepRunId: step.id,
      actor: ctx.host.executorId,
      payload,
    });
    return {
      ref: `checkpoint:${event.id}`,
      ...payload,
      next: 'Resume from this checkpoint; submit only when current-step obligations are satisfied. Preserve unknowns and do not repeat completed effects.',
    };
  },
});
