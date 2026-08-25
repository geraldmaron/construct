/**
 * hosts/mcp/hostpull.ts — the flagged host-pull execution prototype.
 *
 * A host Construct cannot spawn (Bob, goose, nanobot) drives Construct through
 * MCP tool calls but has no path to execute a dispatched task: the presence
 * projection is presence-only and starts no run. This surface is the narrow,
 * flag-gated exception the strategy now permits (RESEARCH-DECISIONS §26/§27):
 * the ambient host's OWN agent loop claims a ready task, executes it on its own
 * already-present capacity, and submits the result as a draft. No paid
 * Construct-side run is started, no agent runtime is built, and no server-push
 * (MCP sampling) is used — these are ordinary host-initiated tool calls.
 *
 * WHY THIS LIVES BESIDE roleserve.ts AND NOT INSIDE THE PROJECTION. The presence
 * projection (cli/serve.ts `serve`) deliberately holds no capability secret and
 * exposes no completion write. Minting a role token needs that secret, so
 * folding claim/submit into the projection would hand the presence surface a
 * secret it was built never to hold. Keeping this a separate server keeps the
 * projection secret-free and byte-identical, and keeps the token-minting seam
 * exactly where the coordinator's is — a code change with a reviewer attached.
 *
 * THE SAFETY INVARIANT IS COMMITMENT 14, AND IT IS PRESERVED STRUCTURALLY, NOT
 * BY A CHECK. This surface exposes exactly two tools: claim a task, submit a
 * draft. The submission goes through the SAME rolewrite seam a spawned role's
 * writes go through (submitDraft), which authorizes against a capability token
 * whose grant set — submit-draft and append-work-log — physically cannot
 * express `record-verdict`. Promotion is DERIVED from recorded verdicts
 * (kernel/run/promotion.ts), and a verdict can only be recorded by a party that
 * is not the deliverable's author, through the dispatcher, which this surface
 * does not reach. A host may therefore produce a draft and never advance it: no
 * tool here promotes, and the token it holds cannot be widened into one. That is
 * the §27 reversal condition met — the inversion does not hand the host a way to
 * mark its own work final.
 *
 * The token is minted per claim, scoped to that one run and task, and expires
 * with the lease. It is not a standing credential and it is not held by the
 * presence projection; a leaked one authorizes at most a bounded number of
 * drafts (the rolewrite draft cap) on a single task within the lease window, and
 * promotes nothing.
 */

import { issueRoleToken, ROLE_GRANTS } from '../../kernel/capabilities/tokens.ts';
import { appendAsRole, submitDraft } from '../../kernel/run/rolewrite.ts';
import type { WriteOutcome } from '../../kernel/run/rolewrite.ts';
import { claimTask } from '../../kernel/store/tasks.ts';
import { appendWorkLog } from '../../kernel/store/worklog.ts';
import type { Store } from '../../kernel/store/open.ts';
import { PROTOCOL_VERSION, response, failure, serveLines } from './jsonrpc.ts';
import type { JsonRpcRequest, JsonRpcResponse } from './jsonrpc.ts';

export { PROTOCOL_VERSION };

/**
 * The environment flag that turns this prototype on. Absent or not exactly
 * "1" means the surface is off, and the CLI verb refuses to serve — a
 * flag-gated prototype is off unless a deployment deliberately enabled it, and
 * "off by default" is checked here rather than in three callers.
 */
export const HOST_PULL_FLAG_ENV = 'CONSTRUCT_HOST_PULL';

/** Whether a deployment has turned the host-pull prototype on. */
export function hostPullEnabled(env: Record<string, string | undefined>): boolean {
  return env[HOST_PULL_FLAG_ENV] === '1';
}

/**
 * How long a host-pull claim leases a task. Matches the coordinator's default:
 * long enough that a host's own agent loop finishes the work, and the token
 * dies with it so a claim never outlives the lease it was minted against.
 */
export const HOST_PULL_LEASE_MS = 15 * 60 * 1000;

/** The lease owner recorded for a host-pull claim, distinct from a coordinator's. */
export const HOST_PULL_OWNER = 'host-pull';

export interface HostPullCore {
  readonly store: Store;
  /** The kernel's token-signing secret. Load-only, exactly as role-serve reads it. */
  readonly secret: string;
  /** Injected; the kernel never reads the clock, and neither does this file. */
  readonly clock: () => string;
  readonly serverVersion: string;
  /** Overridable for tests; the CLI passes the default. */
  readonly leaseMs?: number;
}

/**
 * Two tools, and no third. Claim a ready task, submit a draft for it. There is
 * no tool that records a verdict or advances completion, and the test suite
 * asserts that by name — the same discipline the presence projection holds to.
 */
export const HOST_PULL_TOOLS = [
  {
    name: 'claim_task',
    description:
      'Claim the next ready task so this host can execute it on its own ' +
      'capacity. Returns the task brief and a capability token scoped to THAT ' +
      'task alone. Submitting the finished work is submit_work; the token you ' +
      'get back is what authorizes that submission and nothing else — it cannot ' +
      'advance completion, which turns only on verdicts a dispatcher records. ' +
      'Returns claimed:false when no task is ready, which is normal, not an error.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'submit_work',
    description:
      'Submit the draft you produced for a task you claimed. Pass the task, the ' +
      'token claim_task handed you, and the deliverable. Submitting does not ' +
      'promote: the draft lands on the record and stays a draft until it ' +
      'survives challenges that are not yours to record. Append a note about ' +
      'what you did instead of a deliverable by passing note in place of ' +
      'deliverable.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task id from claim_task.' },
        token: { type: 'string', description: 'The capability token from claim_task.' },
        deliverable: {
          type: 'string',
          description:
            'The finished deliverable: the text itself, or a JSON object serialized as a string.',
        },
        note: {
          type: 'string',
          description:
            'A work-log note in place of a deliverable: what you reviewed, ' +
            'flagged, or could not determine.',
        },
      },
      required: ['task', 'token'],
    },
  },
] as const;

function toolResult(id: unknown, payload: unknown, isError = false): JsonRpcResponse {
  return response(id, {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError,
  });
}

/**
 * The schema declares string (an untyped property routes to zero strict
 * providers), but a string that holds JSON was meant as JSON — mirror the
 * role server's own fromWire so a deliverable stores as the object it is.
 */
function fromWire(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function deadline(now: string, ms: number): string {
  return new Date(Date.parse(now) + ms).toISOString();
}

/**
 * Lease the next ready task and mint a token scoped to it.
 *
 * The token is minted exactly as the coordinator mints one for a spawned role:
 * same grants, expiry pinned to the lease, nonce the lease's fencing token so a
 * re-claim after a crashed lease is distinguishable. What the host receives is
 * the brief to work from and that token; what it can do with the token is
 * submit a draft, which is the whole of the surface.
 */
function claim(core: HostPullCore, id: unknown): JsonRpcResponse {
  const now = core.clock();
  const leaseUntil = deadline(now, core.leaseMs ?? HOST_PULL_LEASE_MS);
  const leased = claimTask(core.store, { owner: HOST_PULL_OWNER, leaseUntil, now });
  if (!leased) {
    return toolResult(id, {
      claimed: false,
      reason: 'no task is ready to claim',
    });
  }

  const token = issueRoleToken(
    {
      run: leased.run,
      task: leased.id,
      role: leased.role,
      expiresAt: leased.leaseUntil,
      nonce: String(leased.token),
    },
    core.secret,
  );

  // The mint is recorded, its scope named; the bearer itself is never logged —
  // a token is a secret and a log is not a vault (same rule as rolewrite.ts and
  // the coordinator's own capability-issued entry).
  appendWorkLog(core.store, {
    run: leased.run,
    task: leased.id,
    role: leased.role,
    action: 'host-pull-claimed',
    detail: { grants: ROLE_GRANTS, expiresAt: leased.leaseUntil, attempt: leased.token, owner: HOST_PULL_OWNER },
    at: now,
  });

  return toolResult(id, {
    claimed: true,
    task: leased.id,
    run: leased.run,
    role: leased.role,
    brief: leased.brief,
    token,
    expiresAt: leased.leaseUntil,
  });
}

/**
 * Submit a draft (or a note) for a claimed task through the existing rolewrite
 * seam.
 *
 * The token the host presents is verified by the same authorize path a spawned
 * role's writes go through: signature, expiry, run and task scope, and the
 * grant. A token minted for task A cannot write to task B, a forged token has no
 * valid signature, and no token — mint it however you like — carries a
 * verdict grant, because ROLE_GRANTS has none to carry. That is why this surface
 * cannot advance completion no matter what the host sends.
 */
function submit(core: HostPullCore, id: unknown, input: Record<string, unknown>): JsonRpcResponse {
  const task = typeof input.task === 'string' ? input.task.trim() : '';
  if (!task) return failure(id, -32602, 'submit_work requires a non-empty string "task"');
  const token = typeof input.token === 'string' ? input.token : '';
  if (!token) return failure(id, -32602, 'submit_work requires a "token" from claim_task');

  const credential = { token, secret: core.secret, at: core.clock() };
  // run is carried as the caller's claim and cross-checked against the token's
  // own scope by rolewrite; the host has it from claim_task. Deriving it from
  // the token would turn that cross-check into a tautology, so it is passed.
  const run = typeof input.run === 'string' ? input.run : '';

  let outcome: WriteOutcome;
  if ('deliverable' in input) {
    outcome = submitDraft(core.store, credential, {
      run,
      task,
      deliverable: fromWire(input.deliverable),
    });
  } else if (typeof input.note === 'string' && input.note.trim() !== '') {
    outcome = appendAsRole(core.store, credential, {
      run,
      task,
      action: 'host-pull-note',
      detail: fromWire(input.note),
    });
  } else {
    return failure(id, -32602, 'submit_work requires either a "deliverable" or a non-empty "note"');
  }

  return toolResult(id, outcome, !outcome.ok);
}

function callTool(core: HostPullCore, id: unknown, params: unknown): JsonRpcResponse {
  const { name, arguments: args } = (params ?? {}) as { name?: unknown; arguments?: unknown };
  const input = (args ?? {}) as Record<string, unknown>;

  if (name === 'claim_task') return claim(core, id);
  if (name === 'submit_work') return submit(core, id, input);

  return failure(
    id,
    -32602,
    `unknown tool ${JSON.stringify(String(name))} — this server offers ${HOST_PULL_TOOLS.map((t) => t.name).join(' and ')}`,
  );
}

/** Handle one decoded JSON-RPC message. Null when the message expects no reply. */
export function handleMessage(core: HostPullCore, message: JsonRpcRequest): JsonRpcResponse | null {
  const method = typeof message.method === 'string' ? message.method : '';
  const isNotification = message.id === undefined || message.id === null;

  switch (method) {
    case 'initialize': {
      const asked = (message.params as { protocolVersion?: unknown } | null)?.protocolVersion;
      return response(message.id, {
        protocolVersion: typeof asked === 'string' && asked ? asked : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: 'construct-host-pull',
          version: core.serverVersion,
          grants: ROLE_GRANTS,
        },
      });
    }
    case 'ping':
      return response(message.id, {});
    case 'tools/list':
      return response(message.id, { tools: HOST_PULL_TOOLS });
    case 'tools/call':
      return callTool(core, message.id, message.params);
    default:
      if (isNotification) return null;
      return failure(message.id, -32601, `method not found: ${method}`);
  }
}

/**
 * Serve the host-pull surface over the given streams until the input ends, on
 * the shared newline-delimited JSON-RPC framing. Synchronous handler, exactly
 * like the role server: nothing here awaits a namer.
 */
export function serveHostPull(
  core: HostPullCore,
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
): Promise<void> {
  return serveLines((message) => handleMessage(core, message), stdin, stdout);
}
