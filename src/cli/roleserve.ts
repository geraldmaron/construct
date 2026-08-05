/**
 * cli/roleserve.ts — the MCP server a role's host connects to: the only door
 * into the kernel a role gets, speaking Model Context Protocol over stdio.
 *
 * This is the seam the capability-token design exists for. rolewrite.ts holds the two gated
 * writes and tokens.ts the bearer they require, but until now no process
 * exposed either to a role running inside a host. This server does, and it is
 * deliberately the CLI's job rather than the kernel's: it reads the process
 * environment (through the roleenv seam) and the clock, both of which the
 * kernel is forbidden.
 *
 * THE ROLE NEVER HOLDS THE BEARER. The host launches this server with the
 * token in ITS environment (see kernel/run/roleenv.ts for why env and not the
 * assignment text). The model calls `submit_draft` and `append_work_log` with
 * no credential arguments at all; this process attaches the bearer on the
 * kernel side of the stdio boundary. What a role cannot see, no transcript can
 * leak and no completion-pressured role can retype into a wider claim.
 *
 * Run and task are similarly not parameters of any tool. They come from the
 * serving environment and are cross-checked against the token's own scope by
 * rolewrite — a server wired for task A cannot be talked into writing to task
 * B, because there is no argument with which to name B.
 *
 * Denials are forwarded to the caller AND recorded by rolewrite, every time,
 * un-collapsed. A role retrying a denied write in a loop does grow the
 * append-only log; that is accepted on purpose (the recorded design-question 3
 * decision): the flood itself is the evidence that a role is fighting its
 * grants, the token's lease-bound expiry caps the window, and rolewrite's
 * covenant is that a refused write is never silently dropped.
 *
 * Protocol scope: exactly what a tools-only MCP server needs — initialize,
 * ping, tools/list, tools/call, and tolerance of notifications. Anything else
 * is answered with method-not-found rather than guessed at.
 */

import { ROLE_GRANTS } from '../kernel/capabilities/tokens.ts';
import { appendAsRole, submitDraft } from '../kernel/run/rolewrite.ts';
import type { WriteOutcome } from '../kernel/run/rolewrite.ts';
import type { Store } from '../kernel/store/open.ts';
import { PROTOCOL_VERSION, response, failure, serveLines } from '../hosts/mcp/jsonrpc.ts';
import type { JsonRpcRequest, JsonRpcResponse } from '../hosts/mcp/jsonrpc.ts';

export { PROTOCOL_VERSION };
export type { JsonRpcResponse };

export interface RoleServeCore {
  readonly store: Store;
  readonly secret: string;
  readonly token: string;
  readonly run: string;
  readonly task: string;
  readonly clock: () => string;
  readonly serverVersion: string;
}

/** The whole tool surface. Two writes, and no third — same as ROLE_GRANTS. */
export const TOOLS = [
  {
    name: 'submit_draft',
    description:
      'Submit a draft of your deliverable to Construct. Submitting does not ' +
      'promote: the draft lands on the record and stays a draft until it ' +
      'survives challenges that are not yours to record.',
    inputSchema: {
      type: 'object',
      properties: {
        deliverable: {
          // Typed as string because strict providers refuse endpoints for any
          // tool whose schema carries an untyped property; the server still
          // accepts an object, and parses a string that holds JSON.
          type: 'string',
          description:
            'The deliverable being drafted: the text itself, or a JSON object serialized as a string.',
        },
      },
      required: ['deliverable'],
    },
  },
  {
    name: 'append_work_log',
    description:
      'Append one entry to the append-only work log in your own name. Use it ' +
      'to record what you reviewed, flagged, or could not determine.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Short action name for the entry (it is namespaced under your role).',
        },
        detail: {
          type: 'string',
          description: 'Optional detail for the entry: text, or JSON serialized as a string.',
        },
      },
      required: ['action'],
    },
  },
] as const;

/**
 * A tool outcome as an MCP result. Both branches are results, not JSON-RPC
 * errors: a denial is the surface working as designed, and the model should
 * read the reason rather than see a transport failure. The outcome never
 * carries the bearer, so neither does anything this server emits.
 */
function toolResult(id: unknown, outcome: WriteOutcome): JsonRpcResponse {
  return response(id, {
    content: [{ type: 'text', text: JSON.stringify(outcome) }],
    isError: !outcome.ok,
  });
}

/**
 * The schema declares string (an untyped property routes to zero strict
 * providers), but a string that holds JSON was meant as JSON — store the value,
 * not its serialization. Objects still pass through for hosts that send them.
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

function callTool(core: RoleServeCore, id: unknown, params: unknown): JsonRpcResponse {
  const { name, arguments: args } = (params ?? {}) as { name?: unknown; arguments?: unknown };
  const input = (args ?? {}) as Record<string, unknown>;
  const credential = { token: core.token, secret: core.secret, at: core.clock() };

  if (name === 'submit_draft') {
    if (!('deliverable' in input)) {
      return failure(id, -32602, 'submit_draft requires a "deliverable" argument');
    }
    return toolResult(
      id,
      submitDraft(core.store, credential, {
        run: core.run,
        task: core.task,
        deliverable: fromWire(input.deliverable),
      }),
    );
  }

  if (name === 'append_work_log') {
    if (typeof input.action !== 'string' || input.action.trim() === '') {
      return failure(id, -32602, 'append_work_log requires a non-empty string "action"');
    }
    return toolResult(
      id,
      appendAsRole(core.store, credential, {
        run: core.run,
        task: core.task,
        action: input.action,
        detail: fromWire(input.detail),
      }),
    );
  }

  return failure(id, -32602, `unknown tool ${JSON.stringify(String(name))} — this server offers ${TOOLS.map((t) => t.name).join(' and ')}`);
}

/**
 * Handle one decoded JSON-RPC message. Returns the response to send, or null
 * when the message expects none (a notification).
 */
export function handleMessage(core: RoleServeCore, message: JsonRpcRequest): JsonRpcResponse | null {
  const method = typeof message.method === 'string' ? message.method : '';
  const isNotification = message.id === undefined || message.id === null;

  switch (method) {
    case 'initialize': {
      const asked = (message.params as { protocolVersion?: unknown } | null)?.protocolVersion;
      return response(message.id, {
        // Echo a client's version when it names one; a mismatch is the
        // client's to judge, and inventing a negotiation here would be
        // guessing at protocol law this server does not need.
        protocolVersion: typeof asked === 'string' && asked ? asked : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: 'construct-role',
          version: core.serverVersion,
          // Not protocol-required, but the first thing a debugging human
          // wants: which grants this surface can ever exercise.
          grants: ROLE_GRANTS,
        },
      });
    }
    case 'ping':
      return response(message.id, {});
    case 'tools/list':
      return response(message.id, { tools: TOOLS });
    case 'tools/call':
      return callTool(core, message.id, message.params);
    default:
      if (isNotification) return null; // notifications/initialized and friends
      return failure(message.id, -32601, `method not found: ${method}`);
  }
}

/**
 * Serve MCP over the given streams until the input ends, on the shared
 * newline-delimited JSON-RPC framing (hosts/mcp/jsonrpc.ts).
 */
export function serveRole(
  core: RoleServeCore,
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
): Promise<void> {
  return serveLines((message) => handleMessage(core, message), stdin, stdout);
}
