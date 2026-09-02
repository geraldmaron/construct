/**
 * hosts/mcp/server.ts — the MCP server a host talks to, built from the
 * broker definitions. One surface per process: the person's interactive
 * session, or an explicitly configured headless runner.
 */

import type { BrokerContext } from '../../kernel/broker/context.ts';
import { mcpTool, record, ToolInputError } from '../../kernel/broker/definition.ts';
import { toolsFor } from '../../kernel/broker/tools.ts';
import { escapeForTerminal } from '../../kernel/render/terminal.ts';
import { failure, response, serveLines, PROTOCOL_VERSION, type AsyncMessageHandler, type JsonRpcRequest } from './jsonrpc.ts';

export type BrokerSurface = 'interactive' | 'headless';

export const SERVER_NAMES: Readonly<Record<BrokerSurface, string>> = { interactive: 'construct', headless: 'construct-runner' };

function text(payload: unknown): { content: Array<{ type: 'text'; text: string }>; structuredContent?: unknown } {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent: payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload : undefined };
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
          instructions:
            surface === 'interactive'
              ? 'Construct is bound to this project. Call bootstrap once, then: answer plain questions without recording anything; use remember when the person asks to keep something; use classify_request and start_outcome for work; do each step here with claim_work and submit_work; surface inbox decisions in conversation and relay them with decide.'
              : 'This is Construct’s runner surface: claim pre-resolved steps, keep leases alive, submit output. It cannot change configuration, grant permissions, decide for the person, or finalize its own output.',
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

export function serveMcp(surface: BrokerSurface, ctx: BrokerContext, stdin: NodeJS.ReadableStream = process.stdin, stdout: NodeJS.WritableStream = process.stdout): Promise<void> {
  return serveLines(createMcpHandler(surface, ctx), stdin, stdout);
}
