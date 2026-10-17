import { closed, str } from '../definition.ts';
import { extendLease, getStep } from '../../state/steps.ts';
import { define, leaseToken } from './shared.ts';

export const heartbeat = define<{ stepRunId: string; token: string }, unknown>({
  name: 'heartbeat',
  title: 'Keep a lease alive',
  description:
    'The session working a claimed step says so, so its lease is not taken over. Any call from the session also extends its leases; this is for a long step with no other call. Fails if the lease was already lost.',
  surface: 'both',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      stepRunId: { type: 'string', description: 'From the claim.' },
      token: { type: 'string', description: 'From the claim: the lease’s secret.' },
    },
    required: ['stepRunId', 'token'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { stepRunId: str(raw, 'stepRunId')!, token: leaseToken(raw) };
  },
  run(ctx, { stepRunId, token }) {
    const at = ctx.now();
    const until = new Date(Date.parse(at) + 30 * 60_000).toISOString();
    if (!extendLease(ctx.store, { id: stepRunId, owner: ctx.host.executorId, nonce: token, until, at })) {
      throw new Error(`step ${stepRunId} is not held by this session under that token`);
    }
    return { leaseUntil: getStep(ctx.store, stepRunId)!.leaseUntil };
  },
});
