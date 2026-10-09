/**
 * hosts/mcp/server.ts — the MCP server a host talks to, built from the
 * broker definitions. Protocol handlers stay in Construct; stdio framing is
 * the official TypeScript SDK transport.
 */

import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { Readable, Writable } from 'node:stream';
import type { BrokerContext } from '../../kernel/broker/context.ts';
import { mcpTool, record, ToolInputError } from '../../kernel/broker/definition.ts';
import { AGENT_NAME, toolsFor } from '../../kernel/broker/tools.ts';
import { STATE_FORMAT_VERSION, UnsupportedStateError } from '../../kernel/state/format.ts';
import { recordClient, touchSession } from '../../kernel/state/sessions.ts';
import { renewExecutorLeases } from '../../kernel/state/steps.ts';
import { renewSessionClaims } from '../../kernel/work/service.ts';
import { HostRequestError, HostRequests } from './outbound.ts';
import { INTERACTIVE_INSTRUCTIONS, RUNNER_INSTRUCTIONS, unboundInstructions } from './instructions.ts';
import type { AskPerson } from '../../kernel/policy/channels.ts';
import { activityCursor, latestActivityId, peerDelta, setActivityCursor, type PeerDelta } from '../../kernel/coord/awareness.ts';

/** How often a session's presence and claim terms are refreshed while it keeps calling. */
const PRESENCE_INTERVAL_MS = 60_000;
/** The term a work claim runs for, and is renewed to. */
const CLAIM_TERM_MS = 30 * 60_000;
import { escapeForTerminal } from '../../kernel/render/terminal.ts';
import { bundleDigest } from '../../kernel/registry/digest.ts';
import type { SkillRegistry } from '../../kernel/registry/skill-registry.ts';
import type { WorkflowRegistry } from '../../kernel/registry/workflow-registry.ts';
import { failure, response, PROTOCOL_VERSION, type AsyncMessageHandler, type JsonRpcRequest, type JsonRpcResponse } from './jsonrpc.ts';

export type BrokerSurface = 'interactive' | 'headless';

export const SERVER_NAMES: Readonly<Record<BrokerSurface, string>> = { interactive: 'construct', headless: 'construct-runner' };

function text(payload: unknown): { content: Array<{ type: 'text'; text: string }>; structuredContent?: unknown } {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent: payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload : undefined };
}

/** A tool result with what peers did since the session last looked, when they did anything. */
function withPeers(payload: unknown, peers: PeerDelta | null): ReturnType<typeof text> {
  if (!peers) return text(payload);
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) return text({ ...payload, construct_peers: peers });
  const plain = text(payload);
  return { ...plain, content: [...plain.content, { type: 'text', text: JSON.stringify({ construct_peers: peers }) }] };
}

/** The instructions a host reads at initialize: the same text for every client on a surface. */
export function instructionsFor(surface: BrokerSurface, unbound: { readonly reason: string; readonly next: string } | null): string {
  if (unbound) return unboundInstructions(unbound.reason, unbound.next);
  return surface === 'interactive' ? INTERACTIVE_INSTRUCTIONS : RUNNER_INSTRUCTIONS;
}

/**
 * Everything a host model reads from Construct on this surface: the server
 * instructions, the tool list exactly as tools/list sends it, the planted
 * operational skill, and the skill and workflow text Construct hands back.
 */
export interface ModelFacingSurface {
  readonly instructions: string;
  readonly tools: readonly Record<string, unknown>[];
  readonly operationalSkillDigest: string | null;
  readonly skills: readonly { readonly id: string; readonly title: string; readonly category: string; readonly description: string }[];
  readonly workflows: readonly {
    readonly id: string;
    readonly title: string;
    readonly interactionClass: string;
    readonly deliverableKind: string;
    readonly inputSchema: Readonly<Record<string, string>>;
    readonly requiredInputs: readonly string[];
    readonly triggers: readonly string[];
  }[];
}

export function modelFacingSurface(surface: BrokerSurface, skills: SkillRegistry, workflows: WorkflowRegistry): ModelFacingSurface {
  const operational = skills.body('construct');
  return {
    instructions: instructionsFor(surface, null),
    tools: toolsFor(surface).map(mcpTool),
    operationalSkillDigest: operational === null ? null : bundleDigest([{ relativePath: 'SKILL.md', bytes: new TextEncoder().encode(operational) }]),
    skills: skills.list().map((s) => ({ id: s.manifest.id, title: s.manifest.title, category: s.manifest.category, description: s.description })),
    workflows: workflows.list().map((w) => ({
      id: w.manifest.id,
      title: w.manifest.title,
      interactionClass: w.manifest.interactionClass,
      deliverableKind: w.manifest.deliverable.kind,
      inputSchema: w.manifest.inputSchema,
      requiredInputs: w.manifest.requiredInputs,
      triggers: w.manifest.triggers,
    })),
  };
}

/** One digest of the model-facing surface: a changed byte in any instruction, description, or schema changes it. */
export function modelFacingDigest(surface: BrokerSurface, skills: SkillRegistry, workflows: WorkflowRegistry): string {
  const parts = modelFacingSurface(surface, skills, workflows);
  const bytes = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  return bundleDigest([
    { relativePath: 'instructions', bytes: bytes(parts.instructions) },
    { relativePath: 'tools.json', bytes: bytes(parts.tools) },
    { relativePath: 'operational-skill', bytes: bytes(parts.operationalSkillDigest ?? '') },
    { relativePath: 'skills.json', bytes: bytes(parts.skills) },
    { relativePath: 'workflows.json', bytes: bytes(parts.workflows) },
  ]);
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

export interface HandlerOptions {
  /** Runs before every tool call: the adapter finishes anything it could not do at launch. */
  readonly beforeEachCall?: () => void;
  /** The channel for requests this server sends the host. */
  readonly hostRequests?: HostRequests;
  /**
   * Whether a question the host shows the person counts as the person's own
   * answer on this machine. The adapter says no when something is configured
   * to answer such questions automatically. A function is asked again before
   * every question and when its answer arrives.
   */
  readonly personPrompts?: boolean | (() => boolean);
  /** How long a question to the person waits before it is left in the inbox. */
  readonly personPromptWaitMs?: number;
}

/** How long a question put to the person through the host waits for an answer. */
export const PERSON_PROMPT_WAIT_MS = 60_000;

/** Ask the person through the host's elicitation: one choice among the options, shown by the host, not the model. */
function elicitor(requests: HostRequests, waitMs: number, stillPerson: () => boolean): AskPerson {
  return async (question) => {
    // Checked when asked and again when answered: a hook written in between could have answered.
    if (!stillPerson()) return { answered: false, why: 'unavailable' };
    try {
      const result = (await requests.request(
        'elicitation/create',
        {
          message: question.message,
          requestedSchema: { type: 'object', properties: { answer: { type: 'string', title: 'Your answer', enum: [...question.options] } }, required: ['answer'] },
        },
        waitMs,
      )) as { action?: unknown; content?: { answer?: unknown } } | null;
      if (result?.action === 'accept') {
        if (!stillPerson()) return { answered: false, why: 'unavailable' };
        const choice = result.content?.answer;
        return typeof choice === 'string' && question.options.includes(choice) ? { answered: true, choice } : { answered: false, why: 'unavailable' };
      }
      return { answered: false, why: result?.action === 'decline' ? 'declined' : 'cancelled' };
    } catch (error) {
      return { answered: false, why: error instanceof HostRequestError && error.reason === 'timeout' ? 'timeout' : 'unavailable' };
    }
  };
}

export function createMcpHandler(surface: BrokerSurface, ctx: BrokerContext, options: HandlerOptions = {}): AsyncMessageHandler {
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
  let lastPresence = 0;
  /**
   * Before each call: say who is acting, keep this session's presence fresh,
   * and extend its claims past half their term, at most once a minute.
   */
  const beforeCall = (args: Record<string, unknown>): void => {
    options.beforeEachCall?.();
    ctx.store.attribution.sessionId = ctx.sessionId;
    ctx.store.attribution.agent = typeof args.agent === 'string' && AGENT_NAME.test(args.agent.trim()) ? args.agent.trim() : null;
    ctx.store.attribution.channel = surface === 'interactive' ? 'relay' : null;
    const now = Date.parse(ctx.now());
    if (ctx.sessionId && now - lastPresence >= PRESENCE_INTERVAL_MS) {
      lastPresence = now;
      const at = new Date(now).toISOString();
      touchSession(ctx.store, { id: ctx.sessionId, at });
      renewSessionClaims(ctx.store, { session: ctx.sessionId, now: at, termMs: CLAIM_TERM_MS });
      renewExecutorLeases(ctx.store, { owner: ctx.host.executorId, now: at, termMs: CLAIM_TERM_MS });
    }
  };
  let callCtx: BrokerContext = ctx;
  let cursor: number | null = null;
  /**
   * After a call: what other sessions and agents did to work since this
   * session last looked. Bootstrap already describes the present, so it only
   * moves the cursor. Awareness is a courtesy; it never fails a call.
   */
  const peersAfter = (toolName: string): PeerDelta | null => {
    if (surface !== 'interactive' || !ctx.sessionId) return null;
    try {
      cursor ??= activityCursor(ctx.store, ctx.sessionId);
      if (toolName === 'bootstrap') {
        const latest = latestActivityId(ctx.store);
        if (latest > cursor) setActivityCursor(ctx.store, ctx.sessionId, (cursor = latest));
        return null;
      }
      const seen = peerDelta(ctx.store, { sessionId: ctx.sessionId, cursor, now: ctx.now(), agent: ctx.store.attribution.agent });
      if (seen.cursor > cursor) setActivityCursor(ctx.store, ctx.sessionId, (cursor = seen.cursor));
      return seen.delta;
    } catch {
      return null;
    }
  };
  return async (message: JsonRpcRequest) => {
    const { id, method, params } = message;
    const isNotification = id === undefined || id === null;
    switch (method) {
      case 'initialize': {
        const declared = (record(params) as { capabilities?: { elicitation?: unknown } }).capabilities;
        const prompts = options.personPrompts;
        const stillPerson = typeof prompts === 'function' ? prompts : () => prompts === true;
        if (surface === 'interactive' && options.hostRequests && stillPerson() && declared && typeof declared === 'object' && declared.elicitation) {
          callCtx = { ...ctx, askPerson: elicitor(options.hostRequests, options.personPromptWaitMs ?? PERSON_PROMPT_WAIT_MS, stillPerson) };
        }
        const client = (record(params) as { clientInfo?: unknown }).clientInfo;
        if (ctx.sessionId && client && typeof client === 'object') {
          const info = client as { name?: unknown; version?: unknown };
          try {
            recordClient(ctx.store, { id: ctx.sessionId, name: typeof info.name === 'string' ? info.name : null, version: typeof info.version === 'string' ? info.version : null, at: ctx.now() });
          } catch {
            // Describing the client is a courtesy; the handshake never fails for it.
          }
        }
        return response(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAMES[surface], version: ctx.version },
          instructions: instructionsFor(surface, null),
        });
      }
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
          const args = record(p.arguments);
          const input = tool.validate(args);
          beforeCall(args);
          const result = await tool.run(callCtx, input);
          return response(id, withPeers(result, peersAfter(tool.name)));
        } catch (error) {
          const messageText = error instanceof Error ? error.message : String(error);
          // Wrong input is a tool error the model reads and corrects; only a tool
          // this surface does not carry is a protocol error.
          if (error instanceof ToolInputError) {
            return response(id, { ...text({ error: messageText, field: error.field, allowed: error.allowed, example: error.example, recovery: { tool: tool.name, inputSchema: tool.inputSchema, next: 'This call failed. Correct the indicated input or satisfy the missing prerequisite, then retry. Do not advance a managed outcome as though this operation succeeded; do not invent a run, source or claim.' } }), isError: true });
          }
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
export function serveHandler(handle: AsyncMessageHandler, stdin: Readable = process.stdin, stdout: Writable = process.stdout, hostRequests?: HostRequests): Promise<void> {
  const transport = new StdioServerTransport(stdin, stdout);
  hostRequests?.attach((message) => transport.send(message as never));
  let chain: Promise<void> = Promise.resolve();
  let running: unknown;
  const cancelled = new Set<unknown>();
  transport.onmessage = (message) => {
    // The host's answer to one of this server's requests settles at once: the
    // call waiting on it holds the queue.
    if (hostRequests?.deliver(message)) return;
    // So does a cancellation: a call not yet started never runs, and one
    // waiting on the host stops waiting. Neither is answered.
    const m = message as JsonRpcRequest;
    if (m.method === 'notifications/cancelled') {
      const target = (record(m.params) as { requestId?: unknown }).requestId;
      if (target === undefined || target === null) return;
      cancelled.add(target);
      if (cancelled.size > 1000) cancelled.delete(cancelled.values().next().value);
      if (target === running) hostRequests?.cancelAll();
      return;
    }
    chain = chain.then(async () => {
      const request = message as JsonRpcRequest;
      const hasId = request.id !== undefined && request.id !== null;
      if (hasId && cancelled.delete(request.id)) return;
      let reply: JsonRpcResponse | null;
      running = hasId ? request.id : undefined;
      hostRequests?.beginCall();
      try {
        reply = await handle(request);
      } catch (error) {
        // One failed message answers its own id and never stops the server.
        reply = hasId ? failure(request.id, -32603, error instanceof Error ? error.message : String(error)) : null;
      } finally {
        running = undefined;
      }
      if (hasId && cancelled.delete(request.id)) return;
      if (reply) await transport.send(reply as never);
    });
  };
  return transport.start().then(
    () =>
      new Promise<void>((resolve) => {
        const done = () => {
          hostRequests?.close();
          void chain.finally(() => {
            void transport.close().finally(resolve);
          });
        };
        stdin.on('end', done);
        stdin.on('close', done);
      }),
  );
}

export function serveMcp(surface: BrokerSurface, ctx: BrokerContext, stdin: Readable = process.stdin, stdout: Writable = process.stdout, options: HandlerOptions = {}): Promise<void> {
  return serveHandler(createMcpHandler(surface, ctx, options), stdin, stdout, options.hostRequests);
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
  options: HandlerOptions = {},
): AsyncMessageHandler {
  const tools = toolsFor(surface);
  const names = new Set(tools.map((t) => t.name));
  let bound: AsyncMessageHandler | null = null;
  let gaveUp: AsyncMessageHandler | null = null;
  let lastBusy = 'the state database is busy';
  let handshake: JsonRpcRequest | null = null;
  const tryBind = async (): Promise<void> => {
    try {
      const handler = createMcpHandler(surface, open(), options);
      // The bound handler learns what the host said at the handshake it did not see.
      if (handshake) await handler({ ...handshake, id: null });
      bound = handler;
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
        handshake = message;
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
        await tryBind();
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
  options: HandlerOptions = {},
): Promise<void> {
  return serveHandler(createLazyMcpHandler(surface, open, version, classify, options), stdin, stdout, options.hostRequests);
}
