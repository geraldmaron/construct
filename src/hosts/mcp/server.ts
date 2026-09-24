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
import { STATE_FORMAT_VERSION, UnsupportedStateError } from '../../kernel/state/format.ts';
import { escapeForTerminal } from '../../kernel/render/terminal.ts';
import { failure, response, PROTOCOL_VERSION, type AsyncMessageHandler, type JsonRpcRequest, type JsonRpcResponse } from './jsonrpc.ts';

export type BrokerSurface = 'interactive' | 'headless';

export const SERVER_NAMES: Readonly<Record<BrokerSurface, string>> = { interactive: 'construct', headless: 'construct-runner' };

function text(payload: unknown): { content: Array<{ type: 'text'; text: string }>; structuredContent?: unknown } {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent: payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload : undefined };
}

function instructionsFor(surface: BrokerSurface, unbound: { readonly reason: string; readonly next: string } | null): string {
  if (unbound) {
    return `Construct could not bind to a project. ${unbound.reason} Call bootstrap: it reports the same condition. ${unbound.next} Do not invent a project or widen permission from this message.`;
  }
  return surface === 'interactive'
    ? 'Construct is bound to this project. Call bootstrap once. Answer plain questions without recording anything. Remember when asked to keep something. For work, classify_request then start_outcome and do each step here with claim_work and submit_work. Challenge consequential work when claim_work says so; do not wait to be asked. Do not invent unknown facts. Proposed statements wait in inbox; relay confirm or retire with decide. Observations are not work. Stay in this session; do not spawn another agent.'
    : 'This is Construct’s runner surface: claim pre-resolved steps, keep leases alive, submit output. It cannot change configuration, grant permissions, decide for the person, or finalize its own output.';
}

/** The state database's schema cookie; it changes whenever any process alters the schema. */
function schemaCookie(ctx: BrokerContext): number {
  const row = ctx.store.db.prepare('PRAGMA schema_version').get() as { schema_version?: number } | undefined;
  return Number(row?.schema_version ?? 0);
}

/** The format this store now carries, read fresh. */
function storedFormatVersion(ctx: BrokerContext): number | null {
  const row = ctx.store.db.prepare(`SELECT value FROM meta WHERE key = 'format_version'`).get() as { value?: string } | undefined;
  const version = Number(row?.value);
  return Number.isFinite(version) ? version : null;
}

export function createMcpHandler(surface: BrokerSurface, ctx: BrokerContext): AsyncMessageHandler {
  const tools = toolsFor(surface);
  const byName = new Map(tools.map((t) => [t.name, t]));
  let cookie = schemaCookie(ctx);
  /**
   * Another build may upgrade the store while this server runs. The schema
   * cookie is one cheap read per call; only when it moves is the format read,
   * and a store this build no longer understands is never written.
   */
  const staleFormat = (): string | null => {
    const now = schemaCookie(ctx);
    if (now === cookie) return null;
    const version = storedFormatVersion(ctx);
    if (version === STATE_FORMAT_VERSION) {
      cookie = now;
      return null;
    }
    return `the state database now carries format ${String(version)}, written by a different Construct build; this server reads format ${String(STATE_FORMAT_VERSION)} and has stopped writing. Restart the MCP server so the matching build binds.`;
  };
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
          const stale = staleFormat();
          if (stale) return response(id, { ...text({ error: stale }), isError: true });
          const input = tool.validate(record(p.arguments));
          const result = await tool.run(ctx, input);
          return response(id, text(result));
        } catch (error) {
          const messageText = error instanceof Error ? error.message : String(error);
          if (error instanceof ToolInputError) return failure(id, -32602, messageText);
          if (error instanceof UnsupportedStateError) {
            return response(id, { ...text({ error: `${messageText.split('\n')[0]!} Nothing was written. Restart the MCP server so the matching Construct build binds.` }), isError: true });
          }
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
export const INIT_NEXT = 'Run `construct init` in the project, then restart this MCP server.';

export function createUnboundMcpHandler(surface: BrokerSurface, reason: string, version: string, next: string = INIT_NEXT): AsyncMessageHandler {
  const payload = {
    bound: false,
    error: reason,
    next,
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
          instructions: instructionsFor(surface, { reason, next }),
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
      const request = message as JsonRpcRequest;
      let reply: JsonRpcResponse | null;
      try {
        reply = await handle(request);
      } catch (error) {
        // One failed message answers its own id and never stops the server.
        const isNotification = request.id === undefined || request.id === null;
        reply = isNotification ? null : failure(request.id, -32603, error instanceof Error ? error.message : String(error));
      }
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
  next: string = INIT_NEXT,
  stdin: Readable = process.stdin,
  stdout: Writable = process.stdout,
): Promise<void> {
  return serveHandler(createUnboundMcpHandler(surface, reason, version, next), stdin, stdout);
}

/** How a lazy server should treat a failed bind: wait and retry, or give up with this advice. */
export type BindFailure = { readonly busy: true } | { readonly busy: false; readonly reason: string; readonly next: string };

/**
 * A server whose project exists but whose store was busy at launch. The tool
 * list does not depend on the store, so the handshake and the tool list are
 * answered at once without touching it. Each tool call tries to bind; a busy
 * store answers "call again", and once a bind succeeds every later message goes
 * to the bound handler. A bind that fails for any other reason (a newer,
 * older, or foreign store) switches the server to the unbound surface with the
 * advice that fits.
 */
export function createLazyMcpHandler(
  surface: BrokerSurface,
  open: () => BrokerContext,
  version: string,
  classify: (error: unknown) => BindFailure,
): AsyncMessageHandler {
  const tools = toolsFor(surface);
  const names = new Set(tools.map((t) => t.name));
  let bound: AsyncMessageHandler | null = null;
  let gaveUp: AsyncMessageHandler | null = null;
  let lastBusy = 'the state database is busy';
  const tryBind = (): void => {
    try {
      bound = createMcpHandler(surface, open());
    } catch (error) {
      const failed = classify(error);
      if (failed.busy) lastBusy = error instanceof Error ? error.message : String(error);
      else gaveUp = createUnboundMcpHandler(surface, failed.reason, version, failed.next);
    }
  };
  return async (message: JsonRpcRequest) => {
    if (bound) return bound(message);
    if (gaveUp) return gaveUp(message);
    const { id, method, params } = message;
    switch (method) {
      case 'initialize':
        return response(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAMES[surface], version },
          instructions: instructionsFor(surface, null),
        });
      case 'tools/list':
        return response(id, { tools: tools.map(mcpTool) });
      case 'tools/call': {
        const name = (record(params) as { name?: unknown }).name;
        if (typeof name !== 'string' || !names.has(name)) {
          return failure(id, -32602, `no tool named "${escapeForTerminal(String(name ?? ''))}" on the ${surface} surface`);
        }
        tryBind();
        if (bound) return (bound as AsyncMessageHandler)(message);
        if (gaveUp) return (gaveUp as AsyncMessageHandler)(message);
        return response(id, { ...text({ bound: false, error: lastBusy, next: 'The store is busy; call again in a moment. Nothing was recorded.' }), isError: true });
      }
      default:
        return createUnboundMcpHandler(surface, lastBusy, version)(message);
    }
  };
}

export function serveLazyMcp(
  surface: BrokerSurface,
  open: () => BrokerContext,
  version: string,
  classify: (error: unknown) => BindFailure,
  stdin: Readable = process.stdin,
  stdout: Writable = process.stdout,
): Promise<void> {
  return serveHandler(createLazyMcpHandler(surface, open, version, classify), stdin, stdout);
}
