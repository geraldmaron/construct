/**
 * lib/mcp/tools/orchestration-delegation-next.tool.mjs — self-registered MCP
 * tool (lib/mcp/tool-registry.mjs) that advances an orchestration-policy
 * route's delegation chain by exactly one step (ADR-0067, construct-rf26.9).
 *
 * orchestration_policy classifies a request into intent/track/specialists/
 * gates and — for a non-immediate track — the full contractChain, for a
 * caller to read and self-sequence. This tool is the flow-engine-backed
 * alternative for the SEQUENCING part specifically: it rebuilds the same
 * deterministic route (routeRequest is a pure function of request/fileCount/
 * moduleCount/introducesContract/explicitDrive) and drives its implied
 * delegation flow (lib/orchestration/delegation-flow.mjs) one checkpointed
 * step at a time, returning only the current specialist's delegation — never
 * the rest of the chain. Call it once per specialist, with the same run_id,
 * until `done` is true; state persists across calls (and across process
 * restarts) via lib/flows/checkpoint.mjs under the machine-scoped state root.
 */

import { routeRequest } from '../../orchestration-policy.mjs';
import { advanceDelegation } from '../../orchestration/delegation-flow.mjs';

export const TOOL_DEFS = [
  {
    name: 'orchestration_delegation_next',
    description:
      'Advance a request\'s delegation chain by exactly one step. Pass the same classification inputs '
      + 'you would give orchestration_policy (request/fileCount/moduleCount/introducesContract/explicitDrive) '
      + 'plus a run_id you mint and keep for this dispatch (e.g. a session or task id). The first call starts '
      + 'the chain and returns the first specialist\'s delegation; each subsequent call with the same run_id '
      + 'returns the next one. Never returns more than the current step — act on currentDelegation only, then '
      + 'call again. `done: true` with `currentDelegation: null` means the chain is exhausted (or the route\'s '
      + 'track resolved to no specialists at all, e.g. immediate).',
    inputSchema: {
      type: 'object',
      required: ['request', 'run_id'],
      properties: {
        request: { type: 'string', description: 'The same request text passed to orchestration_policy.' },
        run_id: { type: 'string', description: 'Caller-chosen id for this dispatch. Reuse it across calls to advance the same chain.' },
        fileCount: { type: 'number', description: 'Approximate number of files involved.' },
        moduleCount: { type: 'number', description: 'Approximate number of modules involved.' },
        introducesContract: { type: 'boolean', description: 'Whether the change introduces a new contract/dependency.' },
        explicitDrive: { type: 'boolean', description: 'Whether drive/full-send mode is explicitly active.' },
      },
    },
    outputSchema: { type: 'object' },
    safety: { class: 'write', filesystem: 'write', network: 'none', process: 'none' },
  },
];

export async function orchestrationDelegationNext(args = {}, { cwd = process.cwd() } = {}) {
  const { request, run_id: runId } = args;
  if (!request || typeof request !== 'string') return { error: 'Missing "request".' };
  if (!runId || typeof runId !== 'string') return { error: 'Missing "run_id" — mint and reuse one id for this dispatch.' };

  const route = routeRequest({
    request,
    fileCount: args.fileCount ?? 0,
    moduleCount: args.moduleCount ?? 0,
    introducesContract: args.introducesContract ?? false,
    explicitDrive: args.explicitDrive ?? false,
  });

  return advanceDelegation(cwd, runId, route);
}

export const TOOL_HANDLERS = {
  orchestration_delegation_next: orchestrationDelegationNext,
};
