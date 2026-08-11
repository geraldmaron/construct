/**
 * hosts/opencode/adapter.ts — OpenCode behind the host adapter seam.
 *
 * This lives outside src/kernel/ deliberately. kernel/hosts/interface.ts defines
 * the shape and ships no adapter, because an adapter is by definition
 * host-coupled; the kernel stays the part that knows nothing about who executes.
 * That is also what package.json's `exports["./hosts/*"]` was reserved for
 *.
 *
 * Commitment 1 in full: Construct rides the host and never rebuilds it. So this
 * file spawns `opencode run --format json` and reads what comes back. There is
 * no session store, no retry policy, no tool broker and no model routing here —
 * OpenCode has all four, and reimplementing any of them is the homebrew-runtime
 * creep STRATEGY risk 4 names. If something is missing, the fix is a flag on the
 * host invocation, not a subsystem on this side of the seam.
 *
 * The process boundary is injected, exactly as cleanup/catalog.ts injects its
 * own: the unit tests drive real adapter code against captured transcripts with
 * no binary present, and scripts/probe-opencode-conformance.mjs is what talks to
 * a live host.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { hostEnvironment, roleServeEnvironment } from '../environment.ts';
import type { HostAdapter, HostCancellation, HostCapability, HostContext, HostHealth, HostResult, ModelTuning } from '../../kernel/hosts/interface.ts';
import { HostNotReadyError, InvocationError, InvocationTimeoutError } from '../../kernel/hosts/errors.ts';
import { failedToolCalls, reduceTranscript } from './events.ts';
import type { OpenCodeRunResult } from './events.ts';
import { PINNED_VERSION, tierOfModel } from './pin.ts';
import { tuningOf } from '../tuning.ts';
import { CONFIG_ENV_VAR, writeAdvisorConfig, writeOpenCodeConfig } from './mcpconfig.ts';
import type { ModelTier } from '../../kernel/brief/tiers.ts';

export const HOST_NAME = 'opencode';

/**
 * 'interrupt' is declared because cancel() genuinely kills the child process.
 * 'concurrent' because each `opencode run` brings up its own server on its own
 * port, so invocations do not share state — with one exception the adapter
 * handles rather than passes on, at the first-run gate below.
 *
 * 'stream' is NOT declared: the transcript is reduced after the process exits.
 * The host does stream, and the interface is explicit that a limitation must be
 * declared rather than hidden — this one is ours, not the host's.
 * 'sandbox' is NOT declared: the child runs with this process's privileges.
 */
export const OPENCODE_CAPABILITIES: readonly HostCapability[] = ['interrupt', 'concurrent'];

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface SpawnedProcess {
  readonly done: Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }>;
  kill(): void;
}

export type OpenCodeSpawnFn = (
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: Readonly<Record<string, string>> },
) => SpawnedProcess;

export interface OpenCodeConfig {
  /** Resolved via PATH when relative, as with docker/launchctl in cleanup/catalog.ts. */
  readonly binary?: string;
  /** `provider/model`, e.g. `ollama/qwen3.5:4b`. Falls back to the host's own default when unset. */
  readonly model?: string;
  /** Working directory for the run. Nothing is read from the ambient cwd. */
  readonly dir?: string;
  readonly timeoutMs?: number;
  readonly spawn?: OpenCodeSpawnFn;
  /** Full argv of the role-serve process; a packaged install overrides the dev default. */
  readonly roleServeCommand?: readonly string[];
  /** Extra environment the role-serve process needs (the store location, typically). */
  readonly roleServeEnv?: Readonly<Record<string, string>>;
}

/** `execute(role, task, tools)` from commitment 1, as a request object. */
export interface OpenCodeRequest {
  readonly role: string;
  readonly task: string;
  /** OpenCode agent to run as. Defaults to the role name. */
  readonly agent?: string;
  readonly model?: string;
  readonly dir?: string;
}

/** What a successful invocation puts in HostResult.output. */
export interface OpenCodeDeliverable {
  readonly role: string;
  readonly text: string;
  readonly sessionId: string | null;
  readonly toolCalls: OpenCodeRunResult['toolCalls'];
  readonly failedToolCalls: OpenCodeRunResult['toolCalls'];
  readonly usage: OpenCodeRunResult['usage'];
  readonly finishReasons: readonly string[];
  readonly notices: readonly string[];
}

export interface OpenCodeAdapter extends HostAdapter {
  readonly pinnedVersion: string;
  /** What the installed binary actually reported at init(). Null before init(). */
  readonly observedVersion: string | null;
  /** True when the installed binary is not the pinned one. */
  readonly versionDrifted: boolean;
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: Readonly<Record<string, string>> },
): SpawnedProcess {
  const child = nodeSpawn(command, [...args], {
    cwd: options.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Chosen, not inherited: construct's own XDG isolation must not
    // re-point the host's configuration and credentials.
    // The overlay carries OPENCODE_CONFIG when a role has a write surface —
    // the bearer itself lives in that file, never here and never on argv.
    env: { ...hostEnvironment(), ...options.env },
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });

  const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

  return { done, kill: () => void child.kill('SIGTERM') };
}

function buildRunArgs(request: OpenCodeRequest, config: OpenCodeConfig): string[] {
  const args = ['run', '--format', 'json'];
  const dir = request.dir ?? config.dir;
  if (dir) args.push('--dir', dir);
  const model = request.model ?? config.model;
  if (model) args.push('--model', model);
  const agent = request.agent;
  if (agent) args.push('--agent', agent);
  args.push(request.task);
  return args;
}

/**
 * The role's framing is prepended to the task rather than passed as a host
 * concept, because "role" is a Construct idea and OpenCode's `--agent` is a
 * different thing with its own config. Callers that have a real OpenCode agent
 * configured pass `agent` explicitly; everyone else gets the role stated in the
 * prompt, which is honest about what the host was actually told.
 */
function framedTask(request: OpenCodeRequest): string {
  return request.agent ? request.task : `You are acting as: ${request.role}.\n\n${request.task}`;
}

export function createOpenCodeAdapter(config: OpenCodeConfig = {}): OpenCodeAdapter {
  const binary = config.binary ?? 'opencode';
  const spawn = config.spawn ?? defaultSpawn;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Only kill() is ever called on these, and an invocation still waiting at the
  // first-run gate has no process to expose — so the map holds what cancel()
  // actually needs rather than a process it may not have yet.
  const inFlight = new Map<string, { kill(): void }>();
  const cancelled = new Set<string>();

  let ready = false;
  let observedVersion: string | null = null;

  /**
   * The first thing to open OpenCode's sqlite database migrates it, and that
   * first open is unreliable. Measured against the pinned version on a fresh
   * data dir:
   *
   *   - two `run`s together: one loses on `PRAGMA journal_mode = WAL`,
   *   - one `run` alone under a real workload: lost on `CREATE TABLE project`.
   *
   * So this is not only a concurrency bug, which is what the report assumed.
   * Whatever meets the cold database first can fail, and under `construct work`
   * that is a real task, failing for a reason with nothing to do with the work.
   *
   * The fix is to make the thing that meets it first be something disposable.
   * `opencode stats` reads that same database and makes no model call, so init()
   * can absorb the migration for free — verified: after it, two concurrent runs
   * against a data dir that was cold both exit 0 with clean stderr.
   *
   * A throwaway `run` would have worked too and was rejected: it is a real model
   * call on every init, spending money the coordinator never sees, and unmetered
   * spend is what the ceiling exists to prevent.
   */
  const WARMUP_ARGS = ['stats'];
  let warmed = false;

  async function warmDatabase(): Promise<boolean> {
    let probe: SpawnedProcess;
    try {
      probe = spawn(binary, WARMUP_ARGS, {});
    } catch {
      return false;
    }
    const result = await probe.done.catch(() => null);
    return result?.code === 0;
  }

  /**
   * The fallback, armed only when the warm-up did not confirm. A future host
   * version could rename `stats` or make it stop touching the database, and the
   * failure would be silent — a cold migration back in front of a real task. So
   * when warming cannot vouch for the database, the first invocation runs alone
   * and the rest wait for it: at most one task can be lost to it instead of
   * however many the coordinator dispatched.
   *
   * Not armed when warming succeeded, because then it is pure loss: it would
   * serialize the first task of every run for a migration that already happened.
   *
   * The gate opens when the first invocation settles, success or failure. A
   * first task that keeps failing must not wedge every task behind it.
   */
  let firstRun: Promise<void> | null = null;

  /**
   * Deliberately synchronous, and it returns rather than awaits. The first
   * caller must reach `spawn` in the same tick it always did: `cancel()` finds a
   * run through the in-flight map, so an `await` inserted before the spawn would
   * silently move the window in which an immediate cancel works.
   */
  function claimFirstRunGate(): { wait: Promise<void> | null; open: (() => void) | null } {
    if (warmed) return { wait: null, open: null };
    if (firstRun !== null) return { wait: firstRun, open: null };
    // The executor runs synchronously, so `open` is assigned before the return.
    let open: () => void = () => {};
    firstRun = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { wait: null, open };
  }

  async function runVersionProbe(): Promise<string> {
    let process: SpawnedProcess;
    try {
      process = spawn(binary, ['--version'], {});
    } catch (cause) {
      throw new InvocationError(`Could not start "${binary}": is OpenCode installed and on PATH?`, {
        host: HOST_NAME,
        code: 'HOST_UNAVAILABLE',
        cause,
      });
    }
    const result = await process.done.catch((cause: unknown) => {
      throw new InvocationError(`Could not start "${binary}": is OpenCode installed and on PATH?`, {
        host: HOST_NAME,
        code: 'HOST_UNAVAILABLE',
        cause,
      });
    });
    const version = result.stdout.trim().split('\n').pop()?.trim() ?? '';
    if (!version) {
      throw new InvocationError(`"${binary} --version" reported nothing`, {
        host: HOST_NAME,
        code: 'HOST_UNAVAILABLE',
      });
    }
    return version;
  }

  const adapter: OpenCodeAdapter = {
    name: HOST_NAME,
    kind: 'coding',
    capabilities: OPENCODE_CAPABILITIES,
    pinnedVersion: PINNED_VERSION,

    /** The model every dispatch will run unless the request overrides it. */
    get model(): string | null {
      return config.model ?? null;
    },

    /** The wall every invocation runs into, stated so a caller can report it. */
    invocationTimeoutMs: timeoutMs,

    /**
     * Tier membership is the pin's to declare, not the kernel's and not this
     * function's. An unrecognised model returns null, which
     * degrades a declared floor rather than satisfying it.
     */
    modelTier(model?: string): ModelTier | null {
      return tierOfModel(model ?? config.model);
    },

    modelTuning(model?: string): ModelTuning {
      return tuningOf(model ?? config.model);
    },

    get observedVersion(): string | null {
      return observedVersion;
    },

    get versionDrifted(): boolean {
      return observedVersion !== null && observedVersion !== PINNED_VERSION;
    },

    async init(): Promise<void> {
      observedVersion = await runVersionProbe();
      // Best-effort, never fatal. A host that answers `--version` can run work;
      // refusing to start because a warm-up command moved would turn a
      // performance guard into an outage. When it does not confirm, the
      // first-run gate below takes over.
      warmed = await warmDatabase();
      ready = true;
    },

    async invoke(request: unknown, context?: HostContext): Promise<HostResult> {
      if (!ready) throw new HostNotReadyError(HOST_NAME);

      const req = request as OpenCodeRequest;
      if (!req || typeof req.role !== 'string' || !req.role || typeof req.task !== 'string' || !req.task) {
        throw new InvocationError('An OpenCode request needs a non-empty role and task', {
          host: HOST_NAME,
          code: 'BAD_REQUEST',
        });
      }

      const id = context?.invocationId ?? `oc-${String(inFlight.size)}-${req.role}`;
      const args = buildRunArgs({ ...req, task: framedTask(req) }, config);

      // Claimed after validation, so a malformed request cannot take the gate
      // and make every other invocation wait on a run that never starts.
      const gate = claimFirstRunGate();
      const openGate = gate.open;

      let started: SpawnedProcess | null = null;
      if (gate.wait) {
        // A run waiting on the gate is in flight as far as the caller is
        // concerned, so cancel() has to be able to reach it. Registering a
        // handle that kills whatever process this invocation ends up with is
        // what makes that true; before the spawn, killing is a no-op and the
        // `cancelled` set is what stops it from ever starting.
        inFlight.set(id, { kill: () => started?.kill() });
        await gate.wait;
        if (cancelled.has(id)) {
          inFlight.delete(id);
          cancelled.delete(id);
          return { id, status: 'cancelled', output: null, error: null };
        }
      }

      // The role's write surface, registered the only way this host supports
      //. Absent roleEnv means no surface at all, which is safe
      // rather than broken — the same default as every other host.
      const roleEnv = context?.roleEnv as Record<string, string> | undefined;
      // Without roleEnv there is still a config: the advisor one, which
      // registers no server and disables the host's tools. Sending a
      // text-only question out with the ambient toolkit enabled is how the
      // densifier stalled to its timeout twice.
      const mcpConfig =
        roleEnv && Object.keys(roleEnv).length > 0
          ? writeOpenCodeConfig(roleEnv, {
              command: config.roleServeCommand,
              // Construct's own directories, put back for construct's own
              // process — the host child had them stripped on purpose.
              env: { ...roleServeEnvironment(), ...config.roleServeEnv },
            })
          : writeAdvisorConfig();

      let child: SpawnedProcess;
      try {
        child = spawn(binary, args, {
          cwd: req.dir ?? config.dir,
          env: { [CONFIG_ENV_VAR]: mcpConfig.path },
        });
      } catch (cause) {
        // A host that never started still has to open the gate. Leaving it shut
        // here would hang every later invocation on a run that does not exist.
        mcpConfig?.dispose();
        inFlight.delete(id);
        openGate?.();
        throw new InvocationError(`Could not start "${binary} run"`, {
          host: HOST_NAME,
          code: 'HOST_UNAVAILABLE',
          cause,
        });
      }
      started = child;
      inFlight.set(id, child);

      // expired is checked after the race as well as raced against, because
      // kill() makes the child exit — so on a timeout both branches become
      // ready and whichever lands first is a coin toss. Racing alone would
      // report a timed-out run as a successful one whenever the child's exit
      // won that toss, which is the failure a timeout exists to prevent.
      // The timer is deliberately NOT unref'd. An unref'd timer does not hold
      // the event loop open, so if nothing else is pending it never fires at
      // all — and the promise it was racing never settles. That is the exact
      // situation a timeout exists for, and it turned this adapter's timeout
      // into a suggestion: `invoke()` would hang forever on an idle loop
      // instead of rejecting. It cost nothing to keep, either, because the
      // `finally` below clears it on every path, so it cannot outlive the
      // invocation and cannot hold the process open past it. A run still in
      // flight SHOULD keep the process alive.
      let expired = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          expired = true;
          child.kill();
          reject(new InvocationTimeoutError(HOST_NAME, timeoutMs));
        }, timeoutMs);
      });

      try {
        const finished = await Promise.race([child.done, timedOut]);
        if (expired) throw new InvocationTimeoutError(HOST_NAME, timeoutMs);

        if (cancelled.has(id)) {
          return { id, status: 'cancelled', output: null, error: null };
        }

        const reduced = reduceTranscript(finished.stdout);

        // Error events are checked before the exit code, and not because the
        // exit code lies — at the pinned version a failed run sets both. They
        // are checked first because only the events carry the diagnosis
        // ("Model not found: ollama/does-not-exist"); the exit code just says 1.
        // Checking both means a future divergence fails closed either way.
        if (reduced.errors.length > 0) {
          return {
            id,
            status: 'error',
            output: null,
            error: {
              host: HOST_NAME,
              messages: reduced.errors,
              exitCode: finished.code,
              stderr: finished.stderr.trim() || null,
            },
          };
        }

        if (finished.code !== 0) {
          return {
            id,
            status: 'error',
            output: null,
            error: {
              host: HOST_NAME,
              messages: [`opencode exited ${String(finished.code)}`],
              exitCode: finished.code,
              stderr: finished.stderr.trim() || null,
            },
          };
        }

        const deliverable: OpenCodeDeliverable = {
          role: req.role,
          text: reduced.text,
          sessionId: reduced.sessionId,
          toolCalls: reduced.toolCalls,
          failedToolCalls: failedToolCalls(reduced),
          usage: reduced.usage,
          finishReasons: reduced.finishReasons,
          notices: reduced.notices,
        };

        return { id, status: 'ok', output: deliverable, error: null };
      } finally {
        if (timer) clearTimeout(timer);
        // Every exit path: a clean return, a timeout, a cancel, a throw. The
        // bearer must not outlive the invocation on disk.
        mcpConfig?.dispose();
        inFlight.delete(id);
        cancelled.delete(id);
        openGate?.();
      }
    },

    async health(): Promise<HostHealth> {
      if (!ready) return { live: false, detail: 'init() has not run' };
      try {
        const version = await runVersionProbe();
        observedVersion = version;
        if (version !== PINNED_VERSION) {
          return {
            live: true,
            detail: `version drift: installed ${version}, pinned ${PINNED_VERSION}. Run scripts/probe-opencode-conformance.mjs before trusting a run.`,
          };
        }
        return { live: true, detail: `opencode ${version} (pinned)` };
      } catch (error) {
        return { live: false, detail: (error as Error).message };
      }
    },

    async cancel(invocationId: string): Promise<HostCancellation> {
      const child = inFlight.get(invocationId);
      if (!child) {
        return { cancelled: false, reason: `no in-flight invocation "${invocationId}"` };
      }
      cancelled.add(invocationId);
      child.kill();
      return { cancelled: true };
    },
  };

  return adapter;
}
