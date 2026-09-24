/**
 * cli/serve.ts — put Construct inside the agent host over MCP, bound to this
 * project and this session. A host launches it; a person rarely types it.
 */

import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { INIT_NEXT, serveLazyMcp, serveMcp, serveUnboundMcp, type BindFailure } from '../hosts/mcp/server.ts';
import { KNOWN_CLIENTS } from '../hosts/wiring/clients.ts';
import { NoProjectError } from '../kernel/project/discover.ts';
import { StateBusyError, UnsupportedStateError } from '../kernel/state/format.ts';
import { BUSY_TIMEOUT_MS } from '../kernel/state/open.ts';
import { endSession, registerSession } from '../kernel/state/sessions.ts';
import { readHostIdentity } from '../hosts/identity.ts';
import { boolFlag, stringFlag, type CommandSpec, type ParsedArgs } from './commands.ts';
import { createContext, mainCheckoutOf, ProjectBusyError, resolveRepository, type CliContext } from './context.ts';
import { HostRequests } from '../hosts/mcp/outbound.ts';
import { refreshLauncher } from './hooks.ts';
import { elicitationAnswerers, pluginHookFiles, projectHookFiles } from '../hosts/elicitation-hooks.ts';
import { managedClaudeSettingsPath, resolveClaudeConfigDir } from '../kernel/paths.ts';
import { bindingFor, openBroker } from './broker-context.ts';
import { OperationError, say, writeJson } from './output.ts';
import { packageVersion } from './version.ts';

export const SERVE_SPEC: CommandSpec = {
  path: ['serve'],
  gloss: 'speak MCP over stdio for the host that launched it, bound to this project',
  group: 'Host',
  positionals: [],
  flags: [
    { name: 'client', gloss: `which host is on the other end: ${KNOWN_CLIENTS.join(' | ')}`, takesValue: true },
    { name: 'project', gloss: 'the project root to bind (default: found from the working directory)', takesValue: true },
    { name: 'headless', gloss: 'serve the runner surface instead of the person’s session', takesValue: false },
    { name: 'executor', gloss: 'the runner’s id, with --headless', takesValue: true },
    { name: 'describe', gloss: 'print the surface this would serve and exit', takesValue: false },
  ],
  readOnly: false,
};

/** How long launch waits for a lock before serving lazily, and how long each lazy bind attempt waits. */
const LAUNCH_LOCK_WAIT_MS = 1000;
const LAZY_LOCK_WAIT_MS = 250;

/** The advice an unbound server gives, by why it could not bind. */
export function bindFailureFor(error: unknown): BindFailure {
  if (error instanceof ProjectBusyError || error instanceof StateBusyError) return { busy: true };
  if (error instanceof UnsupportedStateError) {
    const next = error.kind === 'newer'
      ? 'Upgrade Construct to the version that wrote this project’s state, then restart this MCP server. Do not reset.'
      : error.kind === 'older'
        ? 'Run `construct migrate` in the project (it backs the store up first), then restart this MCP server.'
        : 'Ask the person whether to run `construct reset`; it replaces this project’s state. Then restart this MCP server.';
    return { busy: false, reason: error.message.split('\n')[0]!, next };
  }
  if (error instanceof OperationError) return { busy: false, reason: error.message, next: error.next ?? INIT_NEXT };
  const reason = error instanceof Error ? error.message.split('\n')[0]! : String(error);
  return { busy: false, reason, next: INIT_NEXT };
}

/**
 * Hook files on this machine that could answer a question the host shows the
 * person: the project's (in the session's checkout and the main one), the
 * user's, an administrator's, and installed plugins'.
 */
export function personPromptAnswerers(ctx: CliContext, cwd: string): string[] {
  const checkouts = new Set<string>([cwd]);
  const repo = resolveRepository(cwd);
  if (repo) {
    checkouts.add(repo.checkout);
    const main = mainCheckoutOf(repo);
    if (main) checkouts.add(main);
  }
  const claudeDir = resolveClaudeConfigDir(ctx.env);
  const managed = managedClaudeSettingsPath();
  return elicitationAnswerers([
    ...[...checkouts].flatMap(projectHookFiles),
    join(claudeDir, 'settings.json'),
    join(claudeDir, 'settings.local.json'),
    ...(managed ? [managed] : []),
    ...pluginHookFiles(claudeDir),
  ]);
}

export async function serve(args: ParsedArgs, ctx: CliContext = createContext()): Promise<number> {
  const projectFlag = stringFlag(args, 'project');
  const bound = projectFlag ? { ...ctx, cwd: resolve(projectFlag), sessionCwd: ctx.cwd } : ctx;
  // A question shown to the person counts as theirs only when nothing here can answer it for them.
  const hostOptions = { hostRequests: new HostRequests(), personPrompts: personPromptAnswerers(ctx, ctx.cwd).length === 0 };
  const flags = { client: stringFlag(args, 'client'), headless: boolFlag(args, 'headless'), executor: stringFlag(args, 'executor') };
  const binding = bindingFor(bound, flags);
  const describe = boolFlag(args, 'describe') || args.json;
  let opened: ReturnType<typeof openBroker> | null = null;
  /**
   * Record this server as a session in the project it bound. A store too busy
   * to take the row now gets it before a later call; the server never fails
   * to start for it.
   */
  let registered = false;
  const register = (o: ReturnType<typeof openBroker>): void => {
    o.project.store.attribution.sessionId = o.binding.sessionId;
    if (registered) return;
    const identity = readHostIdentity(ctx.env);
    const lane = o.project.lane;
    try {
      registerSession(o.project.store, {
      id: o.binding.sessionId,
      host: o.binding.client,
      surface: o.binding.surface,
      machine: hostname(),
      pid: process.pid,
      serveVersion: packageVersion(),
      hostSessionId: identity?.hostSessionId,
      hostSessionSource: identity?.source,
      laneRoot: lane?.root,
      branch: lane?.branch ?? undefined,
      head: lane?.head ?? undefined,
      at: ctx.now(),
      });
      registered = true;
    } catch (error) {
      if (!(error instanceof StateBusyError)) throw error;
    }
  };
  /** End the session when the host stops this server by signal, as it would by closing the connection. */
  const endOnSignal = (o: ReturnType<typeof openBroker>): void => {
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
      process.once(signal, () => {
        end(o);
        o.project.store.close();
        process.exit(0);
      });
    }
  };
  const end = (o: ReturnType<typeof openBroker>): void => {
    try {
      endSession(o.project.store, { id: o.binding.sessionId, at: ctx.now(), reason: 'the host closed the connection' });
    } catch {
      // The store is going away with this process; the session simply goes quiet.
    }
  };
  try {
    opened = openBroker(describe ? bound : { ...bound, stateBusyTimeoutMs: LAUNCH_LOCK_WAIT_MS }, flags);
    opened.project.store.db.exec(`PRAGMA busy_timeout = ${String(BUSY_TIMEOUT_MS)}`);
  } catch (error) {
    if (describe) throw error;
    const failed = bindFailureFor(error);
    if (failed.busy) {
      let lazy: ReturnType<typeof openBroker> | null = null;
      try {
        await serveLazyMcp(binding.surface, () => {
          const o = openBroker({ ...bound, stateBusyTimeoutMs: LAZY_LOCK_WAIT_MS }, flags);
          o.project.store.db.exec(`PRAGMA busy_timeout = ${String(BUSY_TIMEOUT_MS)}`);
          lazy = o;
          register(o);
          refreshLauncher(o.project.layout.stateDir);
          endOnSignal(o);
          return o.broker;
        }, packageVersion(), bindFailureFor, process.stdin, process.stdout, {
          ...hostOptions,
          beforeEachCall: () => {
            if (lazy) register(lazy);
          },
        });
      } finally {
        const done = lazy as ReturnType<typeof openBroker> | null;
        if (done) {
          end(done);
          done.project.store.close();
        }
      }
      return 0;
    }
    if (error instanceof NoProjectError || error instanceof OperationError || error instanceof UnsupportedStateError) {
      await serveUnboundMcp(binding.surface, failed.reason, packageVersion(), failed.next);
      return 0;
    }
    throw error;
  }
  const { project, broker } = opened;
  try {
    if (describe) {
      const record = { surface: binding.surface, client: binding.client, executor: binding.executorId, project: project.root, capabilities: [...broker.host.available].sort(), maxTier: broker.host.maxTier };
      if (args.json) writeJson(record);
      else {
        say(`would serve the ${record.surface} surface for ${record.client} bound to ${record.project}`);
        say(`  executor ${record.executor}; may reach ${record.maxTier}; capabilities: ${record.capabilities.join(', ')}`);
      }
      return 0;
    }
    const live = opened;
    register(live);
    refreshLauncher(project.layout.stateDir);
    endOnSignal(live);
    try {
      await serveMcp(binding.surface, broker, process.stdin, process.stdout, { ...hostOptions, beforeEachCall: () => register(live) });
    } finally {
      end(live);
    }
    return 0;
  } finally {
    project.store.close();
  }
}
