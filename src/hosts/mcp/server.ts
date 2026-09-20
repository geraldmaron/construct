/**
 * hosts/mcp/server.ts — the MCP server a host talks to, built from the
 * broker definitions. Protocol handlers stay in Construct; stdio framing is
 * the official TypeScript SDK transport.
 */

import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { Readable, Writable } from 'node:stream';
import type { BrokerContext } from '../../kernel/broker/context.ts';
import { mcpTool, record, ToolInputError } from '../../kernel/broker/definition.ts';
import { toolsFor } from '../../kernel/broker/tools.ts';
import { escapeForTerminal } from '../../kernel/render/terminal.ts';
import { failure, response, PROTOCOL_VERSION, type AsyncMessageHandler, type JsonRpcRequest, type JsonRpcResponse } from './jsonrpc.ts';

export type BrokerSurface = 'interactive' | 'headless';

export const SERVER_NAMES: Readonly<Record<BrokerSurface, string>> = { interactive: 'construct', headless: 'construct-runner' };

function text(payload: unknown): { content: Array<{ type: 'text'; text: string }>; structuredContent?: unknown } {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent: payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload : undefined };
}

function instructionsFor(surface: BrokerSurface, unboundReason: string | null): string {
  if (unboundReason) {
    return `Construct could not bind to a project. ${unboundReason} Call bootstrap: it reports the same condition. Run \`construct init\` in the project, then restart this server. Do not invent a project or widen permission from this message.`;
  }
  return surface === 'interactive'
    ? 'Construct is bound to this project. Call bootstrap once. Answer plain questions without recording anything. Remember when asked to keep something. For work, classify_request then start_outcome and do each step here with claim_work and submit_work. Challenge consequential work when claim_work says so; do not wait to be asked. Do not invent unknown facts. Proposed statements wait in inbox; relay confirm or retire with decide. Observations are not work. Stay in this session; do not spawn another agent.'
    : 'This is Construct’s runner surface: claim pre-resolved steps, keep leases alive, submit output. It cannot change configuration, grant permissions, decide for the person, or finalize its own output.';
}

export function createMcpHandler(surface: BrokerSurface, ctx: BrokerContext): AsyncMessageHandler {
  const tools = toolsFor(surface);
  const byName = new Map(tools.map((t) => [t.name, t]));
  return async (message: JsonRpcRequest) => {
    const { id, method, params } = message;
    const isNotification = id === undefined || id === null;
    switch (method) {
      case 'initialize':
        return response(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAMES[surface], version: ctx.version },
          instructions: instructionsFor(surface, null),
        });
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null;
      case 'ping':
        return response(id, {});
      case 'tools/list':
        return response(id, { tools: tools.map(mcpTool) });
      case 'tools/call': {
        const p = record(params) as { name?: unknown; arguments?: unknown };
        const name = typeof p.name === 'string' ? p.name : '';
        const tool = byName.get(name);
        if (!tool) return failure(id, -32602, `no tool named "${escapeForTerminal(name)}" on the ${surface} surface`);
        try {
          const input = tool.validate(record(p.arguments));
          const result = await tool.run(ctx, input);
          return response(id, text(result));
        } catch (error) {
          const messageText = error instanceof Error ? error.message : String(error);
          if (error instanceof ToolInputError) return failure(id, -32602, messageText);
          return response(id, { ...text({ error: messageText }), isError: true });
        }
      }
      default:
        if (isNotification) return null;
        return failure(id, -32601, `method not found: ${String(method)}`);
    }
  };
}

/** Handshake-capable server when no project is bound, so a host can show why. */
export function createUnboundMcpHandler(surface: BrokerSurface, reason: string, version: string): AsyncMessageHandler {
  const payload = {
    bound: false,
    error: reason,
    next: 'Run `construct init` in the project, then restart this MCP server.',
  };
  return async (message: JsonRpcRequest) => {
    const { id, method, params } = message;
    const isNotification = id === undefined || id === null;
    switch (method) {
      case 'initialize':
        return response(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAMES[surface], version },
          instructions: instructionsFor(surface, reason),
        });
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null;
      case 'ping':
        return response(id, {});
      case 'tools/list':
        return response(id, {
          tools: [
            {
              name: 'bootstrap',
              title: 'Bootstrap',
              description: 'Report that Construct is not bound to a project and what to do next.',
              inputSchema: { type: 'object', properties: {}, additionalProperties: false },
              annotations: { title: 'Bootstrap', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
            },
          ],
        });
      case 'tools/call': {
        const p = record(params) as { name?: unknown };
        const name = typeof p.name === 'string' ? p.name : '';
        if (name !== 'bootstrap') return failure(id, -32602, `no tool named "${escapeForTerminal(name)}" until Construct is bound to a project`);
        return response(id, { ...text(payload), isError: true });
      }
      default:
        if (isNotification) return null;
        return failure(id, -32601, `method not found: ${String(method)}`);
    }
  };
}

/** Official stdio transport: newline-delimited JSON-RPC, replies in arrival order. */
export function serveHandler(handle: AsyncMessageHandler, stdin: Readable = process.stdin, stdout: Writable = process.stdout): Promise<void> {
  const transport = new StdioServerTransport(stdin, stdout);
  let chain: Promise<void> = Promise.resolve();
  transport.onmessage = (message) => {
    chain = chain.then(async () => {
      const reply = await handle(message as JsonRpcRequest);
      if (reply) await transport.send(reply as never);
    });
  };
  return transport.start().then(
    () =>
      new Promise<void>((resolve) => {
        const done = () => {
          void chain.finally(() => {
            void transport.close().finally(resolve);
          });
        };
        stdin.on('end', done);
        stdin.on('close', done);
      }),
  );
}

export function serveMcp(surface: BrokerSurface, ctx: BrokerContext, stdin: Readable = process.stdin, stdout: Writable = process.stdout): Promise<void> {
  return serveHandler(createMcpHandler(surface, ctx), stdin, stdout);
}

export function serveUnboundMcp(
  surface: BrokerSurface,
  reason: string,
  version: string,
  stdin: Readable = process.stdin,
  stdout: Writable = process.stdout,
): Promise<void> {
  return serveHandler(createUnboundMcpHandler(surface, reason, version), stdin, stdout);
}
