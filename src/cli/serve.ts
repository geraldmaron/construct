/**
 * cli/serve.ts — put Construct inside the agent host over MCP, bound to this
 * project and this session. A host launches it; a person rarely types it.
 */

import { realpathSync } from 'node:fs';
import { ProjectFileError, UnsupportedProjectFileError, readJsonFile } from '../kernel/project/files.ts';
import { validateProjectConfig } from '../kernel/project/config.ts';
import { projectFilePath } from '../kernel/project/layout.ts';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { serveLazyMcp, serveMcp, type BindFailure } from '../hosts/mcp/server.ts';
import { KNOWN_CLIENTS } from '../hosts/wiring/clients.ts';
import { LegacyProjectError } from '../kernel/project/initialize.ts';
import { NoProjectError } from '../kernel/project/discover.ts';
import { StoreProjectError } from '../kernel/state/identity.ts';
import { StateBusyError, UnsupportedStateError } from '../kernel/state/format.ts';
import { BUSY_TIMEOUT_MS } from '../kernel/state/open.ts';
import { endSession, registerSession } from '../kernel/state/sessions.ts';
import { readHostIdentity } from '../hosts/identity.ts';
import { boolFlag, stringFlag, type CommandSpec, type ParsedArgs } from './commands.ts';
import { createContext, initRootFor, locateProject, mainCheckoutOf, ProjectBusyError, resolveRepository, type CliContext } from './context.ts';
import { HostRequests } from '../hosts/mcp/outbound.ts';
import { refreshLauncher } from '../hosts/wiring/claude-local.ts';
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

/** Setup repair can be observed by this connection without replacing its session. */
const RETRY_INIT_NEXT = 'Run `construct init` in the project, then call again. This connection retries binding after repair.';

/** The advice an unbound server gives, by why it could not bind. */
export function bindFailureFor(error: unknown): BindFailure {
  if (error instanceof ProjectBusyError || error instanceof StateBusyError) return { busy: true };
  if (error instanceof UnsupportedStateError) {
    const next = error.kind === 'newer'
      ? 'Upgrade Construct to the version that wrote this project’s state, then restart this MCP server. Do not reset.'
      : error.kind === 'older'
        ? 'Run `construct migrate` in the project (it backs the store up first), then call again.'
        : 'Ask the person whether to run `construct reset`; it replaces this project’s state. Then restart this MCP server.';
    return { busy: false, reason: error.message.split('\n')[0]!, next };
  }
  if (error instanceof ProjectFileError) return { busy: false, reason: error.message, next: 'Repair the named project file, then call again. Nothing was recorded.' };
  if (error instanceof UnsupportedProjectFileError || error instanceof LegacyProjectError) return { busy: false, reason: error.message, next: 'Use a Construct build compatible with the project files, then restart this MCP server. Nothing was recorded.' };
  if (error instanceof StoreProjectError) return { busy: false, reason: error.message, next: error.next };
  if (error instanceof NoProjectError) return { busy: false, reason: error.message.split('\n')[0]!, next: RETRY_INIT_NEXT };
  if (error instanceof OperationError) return { busy: false, reason: error.message, next: error.next ?? RETRY_INIT_NEXT };
  const reason = error instanceof Error ? error.message.split('\n')[0]! : String(error);
  return { busy: false, reason, next: 'Inspect the reported failure and repair its cause before retrying. Nothing was recorded.' };
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
  const hostOptions = { hostRequests: new HostRequests(), personPrompts: () => personPromptAnswerers(ctx, ctx.cwd).length === 0 };
  const flags = { client: stringFlag(args, 'client'), headless: boolFlag(args, 'headless'), executor: stringFlag(args, 'executor') };
  const binding = bindingFor(bound, flags);
  const describe = boolFlag(args, 'describe') || args.json;
  // Capture the intended root before retrying. A missing file is not permission
  // to forget an identity already observed before a format or lock refusal.
  const repository = resolveRepository(bound.cwd);
  let intendedRoot = repository?.linked ? mainCheckoutOf(repository) ?? initRootFor(bound.cwd) : initRootFor(bound.cwd);
  try { intendedRoot = locateProject(bound).root; } catch { /* The opener reports the actual failure below. */ }
  intendedRoot = realpathSync(intendedRoot);
  let projectId: string | null = null;
  const openPinned = (timeout: number): ReturnType<typeof openBroker> => {
    const location = locateProject(bound);
    if (realpathSync(location.root) !== intendedRoot) throw new OperationError(
      'The project root changed while this connection was waiting to bind.',
      'Restart the MCP server in the intended project. Nothing was recorded.',
    );
    const id = readJsonFile(intendedRoot, projectFilePath(intendedRoot), validateProjectConfig)?.id ?? null;
    if (projectId !== null && id !== projectId) throw new OperationError(
      'The project identity changed while this connection was waiting to bind.',
      'Restart the MCP server after checking the intended project identity. Nothing was recorded.',
    );
    projectId ??= id;
    return openBroker({ ...bound, stateBusyTimeoutMs: timeout }, flags, binding, { root: intendedRoot, id: projectId });
  };

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
      process.once(signal, async () => {
        await o.broker.delegation?.close();
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
    opened = openPinned(describe ? BUSY_TIMEOUT_MS : LAUNCH_LOCK_WAIT_MS);
    opened.project.store.db.exec(`PRAGMA busy_timeout = ${String(BUSY_TIMEOUT_MS)}`);
  } catch (error) {
    if (describe) throw error;
    const failed = bindFailureFor(error);
    if (failed.busy || error instanceof NoProjectError || error instanceof OperationError || error instanceof UnsupportedStateError || error instanceof ProjectFileError || error instanceof UnsupportedProjectFileError || error instanceof LegacyProjectError || error instanceof StoreProjectError) {
      let lazy: ReturnType<typeof openBroker> | null = null;
      try {
        await serveLazyMcp(binding.surface, () => {
          const o = openPinned(LAZY_LOCK_WAIT_MS);
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
          await done.broker.delegation?.close();
          end(done);
          done.project.store.close();
        }
      }
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
      await broker.delegation?.close();
      end(live);
    }
    return 0;
  } finally {
    project.store.close();
  }
}
