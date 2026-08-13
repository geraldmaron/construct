/**
 * hosts/mcp/projection.ts — the spine made present inside an MCP host.
 *
 * One server reaches every MCP-speaking host (Claude Code, Codex, VS Code
 * agent mode, OpenCode, JetBrains): that is the entire point. Adapters
 * (src/hosts/opencode, src/hosts/claude) remain what they are — execution
 * transports — and this is presence: the user's own host can record outcomes,
 * read the work log and inbox, and relay the user's decisions, without leaving
 * the surface they already work in.
 *
 * Thin is a constraint, not a mood. Every tool here calls a kernel or store
 * function the CLI already calls; there is no logic on this surface that the
 * spine does not already have, and a second orchestrator growing here is
 * exactly the homebrew-runtime creep the strategy vetoes.
 *
 * What is deliberately ABSENT, and why:
 *
 *   - No dispatch. `construct work` spends money on a host adapter, behind the
 *     CLI's explicit opt-in and spend ceiling. The projection is presence,
 *     never execution — a host model must not be able to start a paid run as a
 *     side effect of being helpful. `run_status` is the read of that surface.
 *   - No completion advancement. draft -> challenged -> final is kernel-owned
 *     (a dispatcher-owned transition over recorded verdicts), and no tool on
 *     this server touches it. Role writes (submit_draft, append_work_log) stay
 *     on the token-scoped role server, which a dispatcher launches with a
 *     capability this process never holds.
 *
 * The inversion, inside a host: the model calling these tools has already read
 * the user's words, so `record_outcome` lets it propose domain namings
 * directly — the same namer seam the CLI drives with a subprocess, minus the
 * subprocess. Proposals pass the kernel's admission gate unchanged
 * (implication/naming.ts admissible()): catalog membership, a stated reason,
 * dedup. The host model proposes; it never certifies. Host-model text arriving
 * here is untrusted input exactly as CLI input is.
 */

import { openDecisions, resolveDecision } from '../../kernel/store/decisions.ts';
import { countTasksByState, listTasks } from '../../kernel/store/tasks.ts';
import { readWorkLog } from '../../kernel/store/worklog.ts';
import { storeNamingCache } from '../../kernel/store/namings.ts';
import { recordNote } from '../../kernel/store/notes.ts';
import { startRun, startRunNamed } from '../../kernel/run/outcome.ts';
import type { StartedRun } from '../../kernel/run/outcome.ts';
import { DOMAINS } from '../../kernel/implication/domains.ts';
import { recordVerdict } from '../../kernel/implication/verdict.ts';
import { validateBrief } from '../../kernel/brief/schema.ts';
import type { DomainNaming } from '../../kernel/implication/naming.ts';
import type { Store } from '../../kernel/store/open.ts';
import { PROTOCOL_VERSION, response, failure, serveLines } from './jsonrpc.ts';
import type { JsonRpcRequest, JsonRpcResponse, MessageHandler } from './jsonrpc.ts';

export interface ProjectionCore {
  readonly store: Store;
  /** Injected; the kernel never reads the clock, and neither does this file. */
  readonly clock: () => string;
  readonly serverVersion: string;
}

/**
 * The whole tool surface: reads, two appends (an outcome, a note), and two
 * relays of the user's own judgment (a decision, a verdict). Nothing here
 * advances completion, and the test suite asserts that by name.
 */
export const PROJECTION_TOOLS = [
  {
    name: 'catalog',
    description:
      'The domains Construct can implicate, each with its concern, and the ' +
      'Construct version answering. These are the only domains record_outcome ' +
      'will admit — a domain not listed here is discarded, not created. The ' +
      'version matters because this is the installed Construct, not whatever ' +
      'a repository holds: any statement about what Construct covers is a ' +
      'statement about this version.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'record_outcome',
    description:
      'Record an outcome — what the user wants to happen, in their words. ' +
      'You have already read those words, so you may act as the namer: read ' +
      'the catalog first, then pass `namings`, the catalog domains this ' +
      'outcome implicates, each with the reason in `why`. Passing an empty ' +
      'namings array is a real answer ("this implicates nothing"). Omitting ' +
      'namings entirely leaves the inference to the deterministic keyword ' +
      'map. Your namings are proposals: anything outside the catalog or ' +
      'without a reason is discarded by the kernel, and the reply says what ' +
      'was admitted.',
    inputSchema: {
      type: 'object',
      properties: {
        outcome: { type: 'string', description: "What the user wants to happen, in the user's words." },
        namings: {
          type: 'array',
          description: 'Catalog domains this outcome implicates, with reasons.',
          items: {
            type: 'object',
            properties: {
              domain: { type: 'string', description: 'A domain name from the catalog tool.' },
              why: { type: 'string', description: 'Why this outcome implicates that domain.' },
            },
            required: ['domain', 'why'],
          },
        },
      },
      required: ['outcome'],
    },
  },
  {
    name: 'work_log',
    description:
      'Read the append-only work log: what was inferred, reviewed, and flagged, ' +
      'in whose name. Optionally scoped to one run.',
    inputSchema: {
      type: 'object',
      properties: { run: { type: 'string', description: 'A run id, to scope the read.' } },
    },
  },
  {
    name: 'run_status',
    description:
      'Where tasks stand (pending, leased, done, failed), optionally for one ' +
      'run. Read-only: dispatching tasks costs money and stays on the CLI ' +
      '(`construct work`), behind its explicit spend ceiling.',
    inputSchema: {
      type: 'object',
      properties: { run: { type: 'string', description: 'A run id, to scope the read.' } },
    },
  },
  {
    name: 'inbox',
    description:
      'The open decisions — the calls that are genuinely the user\'s to make, ' +
      'each with the disagreeing positions cited. Show these to the user; they ' +
      'are not yours to resolve.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'decide',
    description:
      'Record the user\'s resolution of an inbox decision. Only relay a call ' +
      'the user explicitly made in their own words — an inbox decision exists ' +
      'precisely because it is not a model\'s to make.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The decision id, from the inbox tool.' },
        resolution: { type: 'string', description: "The user's call, in the user's words." },
      },
      required: ['id', 'resolution'],
    },
  },
  {
    name: 'verdict',
    description:
      'Record the user\'s judgment of what a run surfaced: `confirm` (it was ' +
      'right to surface these), `dismiss` (it was wrong to), `missed` (these ' +
      'should have surfaced and did not). Relay only a judgment the user ' +
      'actually made — these labels are the corpus the routing measurements ' +
      'are computed from, and a model agreeing with itself measures nothing. ' +
      'confirm and dismiss apply only to domains the run surfaced; a domain ' +
      'that never appeared can only be `missed`.',
    inputSchema: {
      type: 'object',
      properties: {
        run: { type: 'string', description: 'The run being judged.' },
        confirm: { type: 'array', items: { type: 'string' }, description: 'Domains it was right to surface.' },
        dismiss: { type: 'array', items: { type: 'string' }, description: 'Domains it was wrong to surface.' },
        missed: { type: 'array', items: { type: 'string' }, description: 'Domains that should have surfaced and did not.' },
      },
      required: ['run'],
    },
  },
  {
    name: 'drop_note',
    description:
      'Record after-call notes exactly as they arrived — a brain dump the ' +
      'user typed or dictated in this session, or the contents of a file ' +
      'they dropped. Pass the text verbatim: the note is the evidence later ' +
      'conclusions cite by line, so a cleaned-up paraphrase would be ' +
      'provenance for words the user never said. Recording draws no ' +
      'conclusions; densification and the context loop happen elsewhere.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'The workspace these notes belong to.' },
        body: { type: 'string', description: "The note text, verbatim, in the user's words." },
        door: {
          type: 'string',
          enum: ['host-session', 'file-drop'],
          description:
            'How the note arrived: typed or dictated in this session ' +
            '(host-session), or as a dropped file whose text you are relaying ' +
            '(file-drop).',
        },
        run: { type: 'string', description: 'A run id, when the notes belong to one.' },
      },
      required: ['workspace', 'body', 'door'],
    },
  },
  {
    name: 'validate_brief',
    description:
      'Check a brief against its schema: what a task declares it needs ' +
      '(inputs, capabilities, postconditions). Returns the problems, if any. ' +
      'Validation only — nothing is stored.',
    inputSchema: {
      type: 'object',
      properties: { brief: { description: 'The brief to validate, as JSON.' } },
      required: ['brief'],
    },
  },
] as const;

function toolResult(id: unknown, payload: unknown, isError = false): JsonRpcResponse {
  return response(id, {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError,
  });
}

/** The reply `record_outcome` sends back: what was admitted, and how. */
function startedReply(started: StartedRun, proposed?: readonly DomainNaming[]): unknown {
  const admitted = new Set(started.implicated.map((i) => i.domain));
  return {
    run: started.runId,
    outcome: started.outcome,
    implicated: started.implicated.map((i) => ({
      domain: i.domain,
      concern: i.concern,
      reason: i.signals.join(' '),
    })),
    inferredBy: started.inferredBy,
    tasksQueued: started.tasks.length,
    ...(started.namerFailure !== undefined ? { namerFailure: started.namerFailure } : {}),
    // Proposals the kernel did not admit, named so the model hears the gate
    // rather than assuming everything it said was accepted.
    ...(proposed
      ? { notAdmitted: proposed.map((n) => n?.domain).filter((d) => typeof d === 'string' && !admitted.has(d)) }
      : {}),
  };
}

async function recordOutcome(
  core: ProjectionCore,
  client: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const text = typeof input.outcome === 'string' ? input.outcome.trim() : '';
  if (!text) throw new RangeError('record_outcome requires a non-empty string "outcome"');

  const at = core.clock();
  const runId = `run-${at.replace(/[-:.TZ]/g, '')}`;

  if (input.namings === undefined) {
    // No proposals: the deterministic keyword path, exactly as the CLI's
    // host-less form. Free, no model consulted, and it says so via inferredBy.
    return startedReply(startRun(core.store, { runId, outcome: text, at }));
  }

  if (!Array.isArray(input.namings)) {
    throw new RangeError('record_outcome "namings" must be an array of {domain, why}');
  }
  const namings = input.namings as readonly DomainNaming[];
  const host = `mcp:${client}`;
  const started = await startRunNamed(core.store, {
    runId,
    outcome: text,
    at,
    host,
    // The caller is the model: its proposals ARE the namer's answer, and they
    // pass the same admission gate a subprocess namer's would.
    namer: () => Promise.resolve(namings),
    cache: storeNamingCache(core.store, { host, at }),
  });
  return startedReply(started, namings);
}

/** A verdict list argument: absent is empty, anything else must be strings. */
function domainList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new RangeError(`verdict "${field}" must be an array of domain names`);
  }
  return value as string[];
}

function runStatus(core: ProjectionCore, run: string | undefined): unknown {
  return {
    counts: countTasksByState(core.store, run),
    tasks: listTasks(core.store, run).map((t) => ({
      id: t.id,
      run: t.run,
      role: t.role,
      state: t.state,
      ...(t.leaseUntil ? { leaseUntil: t.leaseUntil } : {}),
    })),
  };
}

async function callTool(
  core: ProjectionCore,
  client: string,
  id: unknown,
  params: unknown,
): Promise<JsonRpcResponse> {
  const { name, arguments: args } = (params ?? {}) as { name?: unknown; arguments?: unknown };
  const input = (args ?? {}) as Record<string, unknown>;
  const run = typeof input.run === 'string' ? input.run : undefined;

  try {
    switch (name) {
      case 'catalog':
        // The version answering rides on the catalog because the catalog is
        // what a claim about coverage is made from, and a host reaches whatever
        // Construct is installed rather than whatever a repository holds. A
        // trial found a machine answering with fifteen domains while the tree
        // carried seventeen, unwarned on either side: the operator was reading
        // a released catalog and had no way to know which release. serverInfo
        // carries this too, and a model that read the catalog and never saw the
        // handshake is the reader this is for.
        return toolResult(id, {
          construct: core.serverVersion,
          domains: DOMAINS.map((d) => ({ domain: d.domain, concern: d.concern })),
        });
      case 'record_outcome':
        return toolResult(id, await recordOutcome(core, client, input));
      case 'work_log':
        return toolResult(id, { entries: readWorkLog(core.store, run) });
      case 'run_status':
        return toolResult(id, runStatus(core, run));
      case 'inbox':
        return toolResult(id, { decisions: openDecisions(core.store) });
      case 'decide': {
        if (typeof input.id !== 'string' || !input.id) {
          throw new RangeError('decide requires a string "id"');
        }
        const resolution = typeof input.resolution === 'string' ? input.resolution.trim() : '';
        if (!resolution) throw new RangeError('decide requires a non-empty string "resolution"');
        resolveDecision(core.store, input.id, resolution, core.clock());
        return toolResult(id, { decided: input.id, resolution });
      }
      case 'verdict': {
        if (run === undefined) throw new RangeError('verdict requires a string "run"');
        const recorded = recordVerdict(core.store, {
          run,
          confirm: domainList(input.confirm, 'confirm'),
          dismiss: domainList(input.dismiss, 'dismiss'),
          missed: domainList(input.missed, 'missed'),
          // Whose surface the judgment came through, kept distinct from the
          // CLI's `user` so the corpus can be read by provenance later.
          source: `mcp:${client}`,
          at: core.clock(),
        });
        return toolResult(id, { run, ...recorded });
      }
      case 'drop_note': {
        const workspace = typeof input.workspace === 'string' ? input.workspace.trim() : '';
        if (!workspace) throw new RangeError('drop_note requires a non-empty string "workspace"');
        const body = typeof input.body === 'string' ? input.body : '';
        const door = input.door;
        if (door !== 'host-session' && door !== 'file-drop') {
          throw new RangeError('drop_note "door" must be "host-session" or "file-drop"');
        }
        const at = core.clock();
        // Two notes can arrive in one clock tick; the count only grows (the
        // table is append-only), so it makes the id unique where the
        // timestamp alone is not.
        const { n } = core.store.db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number };
        const noteId = `note-${at.replace(/[-:.TZ]/g, '')}-${n + 1}`;
        recordNote(core.store, {
          id: noteId,
          workspace,
          run: run ?? null,
          door,
          body,
          recordedAt: at,
        });
        // The line count is what a later citation is bounded by; returning it
        // tells the model what `note:<id>#L<n>` can legally name.
        return toolResult(id, { note: noteId, door, lines: body.split('\n').length });
      }
      case 'validate_brief':
        if (!('brief' in input)) throw new RangeError('validate_brief requires a "brief" argument');
        return toolResult(id, validateBrief(input.brief));
      default:
        return failure(
          id,
          -32602,
          `unknown tool ${JSON.stringify(String(name))} — this server offers ${PROJECTION_TOOLS.map((t) => t.name).join(', ')}`,
        );
    }
  } catch (error) {
    // A refused write or a bad argument is the surface working as designed;
    // the model should read the reason, not see a transport failure.
    return toolResult(id, { ok: false, error: (error as Error).message }, true);
  }
}

/**
 * The projection's message handler. A factory rather than a stateless
 * function because one fact accumulates per connection: the client's declared
 * name from initialize, which becomes the `host` a model-proposed naming is
 * logged under — the log must say whose model read the outcome.
 *
 * Async where roleserve's is not, because record_outcome awaits the namer
 * seam. The serve loop below adapts.
 */
export function createProjectionHandler(
  core: ProjectionCore,
): (message: JsonRpcRequest) => Promise<JsonRpcResponse | null> {
  let client = 'unknown-client';

  return async (message: JsonRpcRequest): Promise<JsonRpcResponse | null> => {
    const method = typeof message.method === 'string' ? message.method : '';
    const isNotification = message.id === undefined || message.id === null;

    switch (method) {
      case 'initialize': {
        const params = message.params as
          | { protocolVersion?: unknown; clientInfo?: { name?: unknown } }
          | null;
        const declared = params?.clientInfo?.name;
        if (typeof declared === 'string' && declared) client = declared;
        const asked = params?.protocolVersion;
        return response(message.id, {
          // Echo a client's version when it names one; a mismatch is the
          // client's to judge, exactly as on the role server.
          protocolVersion: typeof asked === 'string' && asked ? asked : PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'construct', version: core.serverVersion },
        });
      }
      case 'ping':
        return response(message.id, {});
      case 'tools/list':
        return response(message.id, { tools: PROJECTION_TOOLS });
      case 'tools/call':
        return callTool(core, client, message.id, message.params);
      default:
        if (isNotification) return null; // notifications/initialized and friends
        return failure(message.id, -32601, `method not found: ${method}`);
    }
  };
}

/**
 * Serve the projection over stdio until the client hangs up. Replies are
 * written in completion order; MCP correlates by id.
 *
 * The resolve waits for every in-flight tool call, not just the stream end:
 * the caller closes the store when this settles, and a record_outcome still
 * writing to a closed database is the exact failure mode the CLI's
 * withStoreAsync exists to prevent.
 */
export async function serveProjection(
  core: ProjectionCore,
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
): Promise<void> {
  const handle = createProjectionHandler(core);
  const pending = new Set<Promise<void>>();
  const syncAdapter: MessageHandler = (message) => {
    const settled = handle(message).then((reply) => {
      if (reply) stdout.write(`${JSON.stringify(reply)}\n`);
    });
    pending.add(settled);
    void settled.finally(() => pending.delete(settled));
    return null;
  };
  await serveLines(syncAdapter, stdin, stdout);
  await Promise.all([...pending]);
}
