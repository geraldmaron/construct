/**
 * cli/roleserve.ts — the MCP server a role's host connects to: the only door
 * into the kernel a role gets, speaking Model Context Protocol over stdio.
 *
 * This is the seam construct-3sa exists for. rolewrite.ts holds the two gated
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
 * append-only log; that is accepted on purpose (the construct-3sa question 3
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

export const PROTOCOL_VERSION = '2025-06-18';

export interface RoleServeCore {
  readonly store: Store;
  readonly secret: string;
  readonly token: string;
  readonly run: string;
  readonly task: string;
  readonly clock: () => string;
  readonly serverVersion: string;
}

interface JsonRpcRequest {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: unknown;
  readonly result?: unknown;
  readonly error?: { code: number; message: string };
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
          description: 'The deliverable being drafted, as JSON (an object or a string).',
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
        detail: { description: 'Optional detail for the entry, as JSON.' },
      },
      required: ['action'],
    },
  },
] as const;

function response(id: unknown, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function failure(id: unknown, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

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
        deliverable: input.deliverable,
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
        detail: input.detail,
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
 * Serve MCP over the given streams until the input ends. Newline-delimited
 * JSON-RPC, per the MCP stdio transport. Resolves when the client hangs up.
 */
export function serveRole(
  core: RoleServeCore,
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
): Promise<void> {
  return new Promise((resolve) => {
    let buffer = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;

        let message: JsonRpcRequest;
        try {
          message = JSON.parse(line) as JsonRpcRequest;
        } catch {
          stdout.write(`${JSON.stringify(failure(null, -32700, 'parse error'))}\n`);
          continue;
        }
        const reply = handleMessage(core, message);
        if (reply) stdout.write(`${JSON.stringify(reply)}\n`);
      }
    });
    stdin.on('end', () => resolve());
    stdin.on('close', () => resolve());
  });
}
