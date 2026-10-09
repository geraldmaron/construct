import type { BrokerContext } from './context.ts';
import { closed, list, num, str, ToolInputError, type ToolDefinition } from './definition.ts';
import { asPeerData } from '../work/handoff.ts';
import { EXECUTORS, type Assignment, type Disposition } from '../delegation/types.ts';

const DISPOSITION_FIELDS: readonly string[] = ['findingId', 'decision', 'rationale'];

type Input = { readonly action: string; readonly id?: string; readonly assignment?: Assignment; readonly dispositions?: readonly Disposition[] };

export const delegate: ToolDefinition<BrokerContext, Input, unknown> = {
  name: 'delegate',
  title: 'Bounded local delegation',
  description: 'Opt-in local subscription workers, owned by this lead session. Start returns an execution id immediately; status, result, and cancel supervise it. Implementation requires existing claimed work, scoped paths and acceptance checks. Review a fixed implementation with role review and subject. Triage every finding before serial local integration and combined validation. No recursive dispatch, commits, publication, approval inheritance, or automatic executor fallback. Disabled until explicit configuration and matching live evidence exist.',
  surface: 'interactive',
  readOnly: false,
  destructive: true,
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['start', 'status', 'result', 'cancel', 'triage', 'integrate'], description: 'Execution lifecycle or lead-only review/integration action.' },
      id: { type: 'string', description: 'Execution id; optional only for aggregate status.' },
      workId: { type: 'string', description: 'Existing native work with an unexpired claim held by this lead.' },
      requestKey: { type: 'string', description: 'Stable idempotency key, reused only for the identical assignment.' },
      executor: { type: 'string', enum: EXECUTORS, description: 'Explicitly configured local executor; installation alone grants nothing.' },
      role: { type: 'string', enum: ['implement', 'review'], description: 'Implementation or read-only independent review.' },
      instructions: { type: 'string', description: 'Bounded assignment, not the full lead conversation.' },
      acceptance: { type: 'array', items: { type: 'string' }, description: 'Observable acceptance checks.' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Repository-relative files or directory prefixes ending in /.' },
      couplingKeys: { type: 'array', items: { type: 'string' }, description: 'Shared interface/schema keys that must execute serially despite disjoint paths.' },
      timeoutMs: { type: 'number', description: 'Per-attempt bound; default 1200000, capped by personal configuration.' },
      runId: { type: 'string', description: 'Existing workflow run to link to the child work.' },
      subject: { type: 'string', description: 'Successful implementation execution to review at its fixed snapshot.' },
      repairOf: { type: 'string', description: 'Successful implementation being repaired; bounded repair counter is inherited.' },
      dispositions: { type: 'array', items: { type: 'object' }, description: 'Exactly one {findingId, decision: accepted|rejected|deferred, rationale} per review finding.' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    const action = str(raw, 'action', { oneOf: ['start', 'status', 'result', 'cancel', 'triage', 'integrate'] })!;
    const permitted = action === 'start'
      ? ['action', 'workId', 'requestKey', 'executor', 'role', 'instructions', 'acceptance', 'paths', 'couplingKeys', 'timeoutMs', 'runId', 'subject', 'repairOf']
      : action === 'triage' ? ['action', 'id', 'dispositions'] : ['action', 'id'];
    const stray = Object.keys(raw).find(key => !permitted.includes(key));
    if (stray !== undefined) throw new ToolInputError(`"${stray}" does not apply to the ${action} action`, { field: stray, allowed: permitted });
    if (action === 'start') {
      const strings = (key: string): string[] => {
        const values = list(raw, key);
        if (values.some(value => typeof value !== 'string')) throw new ToolInputError(`"${key}" must contain strings`, { field: key });
        return values as string[];
      };
      return { action, assignment: {
        workId: str(raw, 'workId')!, requestKey: str(raw, 'requestKey')!, executor: str(raw, 'executor', { oneOf: EXECUTORS })! as Assignment['executor'],
        role: str(raw, 'role', { oneOf: ['implement', 'review'] })! as Assignment['role'], instructions: str(raw, 'instructions')!, acceptance: strings('acceptance'),
        paths: strings('paths'), couplingKeys: strings('couplingKeys'), timeoutMs: num(raw, 'timeoutMs') ?? 20 * 60_000,
        runId: str(raw, 'runId', { optional: true }), subject: str(raw, 'subject', { optional: true }), repairOf: str(raw, 'repairOf', { optional: true }),
      } };
    }
    const id = str(raw, 'id', { optional: action === 'status' });
    if (action !== 'triage') return { action, id };
    const dispositions = list(raw, 'dispositions').map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ToolInputError('"dispositions" holds one {findingId, decision, rationale} object per finding', { field: 'dispositions' });
      const entry = value as Record<string, unknown>;
      const strayField = Object.keys(entry).find(key => !DISPOSITION_FIELDS.includes(key));
      if (strayField !== undefined) throw new ToolInputError(`"${strayField}" is not a disposition field`, { field: 'dispositions', allowed: DISPOSITION_FIELDS });
      return { findingId: str(entry, 'findingId')!, decision: str(entry, 'decision', { oneOf: ['accepted', 'rejected', 'deferred'] })! as Disposition['decision'], rationale: str(entry, 'rationale')! };
    });
    return { action, id, dispositions };
  },
  async run(ctx, input) {
    const service = ctx.delegation;
    if (!service) throw new Error('delegation is unavailable on this host surface');
    if (input.action === 'start') return service.start(input.assignment!);
    if (input.action === 'status') return service.status(input.id);
    if (input.action === 'cancel') return service.cancel(input.id!);
    if (input.action === 'integrate') return service.integrate(input.id!);
    if (input.action === 'triage') return asPeerData('independent review', service.triage(input.id!, input.dispositions!));
    return asPeerData('local worker; not an approval', service.result(input.id!));
  },
};
