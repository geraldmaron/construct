/**
 * hosts/codex/adapter.ts — the Codex CLI behind the host adapter seam: the
 * third host, and the first that spends a subscription rather than an API
 * key. `codex login status` on this machine answers "Logged in using
 * ChatGPT"; whatever the user already pays for is what dispatch runs on.
 *
 * Same shape and same restraint as the OpenCode and Claude adapters: spawn
 * `codex exec --json`, read the event stream back, reimplement nothing the
 * host already owns. The differences are the host's, and they are written
 * down in pin.ts as probed expectations:
 *
 *   - Cost is unmeasured, not zero. The stream reports token counts and no
 *     dollars; a subscription run has no per-run price. Usage carries zero
 *     cost with zero steps, which spendOf() already reads as unmeasured.
 *   - The -m flag is a constraint, not a preference. An unknown model is
 *     refused by the backend rather than silently substituted, so a
 *     deliverable's modelRan is the requested name when one was requested —
 *     the inverse of the Claude host's silent-fallback hazard.
 *   - An untuned family still runs. The gpt family has no TUNED_FAMILIES
 *     entry, so every dispatch is labeled best-effort with a degradation
 *     note — labeled, never refused: a capable model outside the tuned
 *     matrix is exactly what the matrix's honest label exists for.
 *   - No role write surface yet. The host configures MCP servers through its
 *     own config files; wiring construct's role-serve through them is its own
 *     probed change. A dispatch that supplies roleEnv gets a notice saying
 *     the surface is absent rather than a silently read-only role.
 *   - Isolation is flags, not environment surgery: --ephemeral (no session
 *     files), --ignore-user-config (the user's config.toml and MCP servers
 *     stay out of construct's runs; auth still resolves), and a read-only
 *     sandbox for model-run commands.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { hostEnvironment } from '../environment.ts';
import type { HostAdapter, HostCancellation, HostCapability, HostContext, HostHealth, HostResult, ModelTuning } from '../../kernel/hosts/interface.ts';
import { HostNotReadyError, InvocationError, InvocationTimeoutError } from '../../kernel/hosts/errors.ts';
import { reduceStream } from './result.ts';
import type { CodexUsage } from './result.ts';
import { PINNED_VERSION, tierOfModel } from './pin.ts';
import { tuningOf } from '../tuning.ts';
import type { ModelTier } from '../../kernel/brief/tiers.ts';
import { frameHostTask } from '../../kernel/voice/voice.ts';

export const HOST_NAME = 'codex';

/**
 * The family this binary serves when no model is named — same reasoning as
 * the Claude adapter's probe string, resolved through the same tuning table
 * so a family entering TUNED_FAMILIES changes the answer here too.
 */
const HOST_FAMILY_PROBE = 'gpt-';

/** Killing the child genuinely interrupts; runs share nothing in-process. */
/**
 * No `outward-write`: dispatch runs `-s read-only`, a probed expectation, so a
 * model here cannot act on anything outside the process however it is asked.
 */
export const CODEX_CAPABILITIES: readonly HostCapability[] = ['interrupt', 'concurrent'];

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface SpawnedProcess {
  readonly done: Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }>;
  kill(): void;
}

export type CodexSpawnFn = (
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string },
) => SpawnedProcess;

export interface CodexConfig {
  /** Resolved via PATH when relative. */
  readonly binary?: string;
  /** Model name, e.g. `gpt-5.2-codex`. See pin.ts: a constraint, not a preference. */
  readonly model?: string;
  readonly dir?: string;
  readonly timeoutMs?: number;
  readonly spawn?: CodexSpawnFn;
}

export interface CodexRequest {
  readonly role: string;
  readonly task: string;
  readonly model?: string;
  readonly dir?: string;
}

/** Same keys as the OpenCode and Claude deliverables — that parity is the point. */
export interface CodexDeliverable {
  readonly role: string;
  readonly text: string;
  readonly sessionId: string | null;
  readonly toolCalls: readonly unknown[];
  readonly failedToolCalls: readonly unknown[];
  readonly usage: CodexUsage;
  readonly finishReasons: readonly string[];
  readonly notices: readonly string[];
  readonly modelRequested: string | null;
  readonly modelRan: readonly string[];
}

export interface CodexAdapter extends HostAdapter {
  readonly pinnedVersion: string;
  readonly observedVersion: string | null;
  readonly versionDrifted: boolean;
}

function defaultSpawn(command: string, args: readonly string[], options: { cwd?: string }): SpawnedProcess {
  const child = nodeSpawn(command, [...args], {
    cwd: options.cwd,
    // Stdin ignored is load-bearing: piped stdin becomes prompt text on this
    // host (pin: stdin-must-stay-closed).
    stdio: ['ignore', 'pipe', 'pipe'],
    // Chosen, not inherited: construct's own XDG isolation must not
    // re-point the host's configuration and credentials.
    env: hostEnvironment(),
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

function buildRunArgs(task: string, model: string | undefined): string[] {
  const args = [
    'exec',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--skip-git-repo-check',
    '-s',
    'read-only',
  ];
  if (model) args.push('-m', model);
  args.push(task);
  return args;
}

/** Same framing rule as every other adapter, and it is written in one place. */
function framedTask(request: CodexRequest): string {
  return frameHostTask(request);
}

export function createCodexAdapter(config: CodexConfig = {}): CodexAdapter {
  const binary = config.binary ?? 'codex';
  const spawn = config.spawn ?? defaultSpawn;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const inFlight = new Map<string, SpawnedProcess>();
  const cancelled = new Set<string>();

  let ready = false;
  let observedVersion: string | null = null;

  async function runVersionProbe(): Promise<string> {
    let probe: SpawnedProcess;
    try {
      probe = spawn(binary, ['--version'], {});
    } catch (cause) {
      throw new InvocationError(`Could not start "${binary}": is the Codex CLI installed and on PATH?`, {
        host: HOST_NAME,
        code: 'HOST_UNAVAILABLE',
        cause,
      });
    }
    const result = await probe.done.catch((cause: unknown) => {
      throw new InvocationError(`Could not start "${binary}": is the Codex CLI installed and on PATH?`, {
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

  const adapter: CodexAdapter = {
    name: HOST_NAME,
    kind: 'coding',
    capabilities: CODEX_CAPABILITIES,
    pinnedVersion: PINNED_VERSION,

    /** The model every dispatch will request unless the request overrides it. */
    get model(): string | null {
      return config.model ?? null;
    },

    /** The wall every invocation runs into, stated so a caller can report it. */
    invocationTimeoutMs: timeoutMs,

    /**
     * Tier membership is the pin's to declare. Null for an unrecognised name
     * means "will be refused", not "will run something else" — see the
     * unknown-model-fails-hard expectation.
     */
    modelTier(model?: string): ModelTier | null {
      return tierOfModel(model ?? config.model);
    },

    /**
     * This binary serves one vendor's models, so an unnamed model is still
     * that vendor's family. The gpt family carries no tuning evidence today,
     * so the honest answer is untuned — which labels the dispatch best-effort
     * with a degradation note and runs it anyway. A capable model outside the
     * tuned matrix functions; it is labeled, never refused.
     */
    modelTuning(model?: string): ModelTuning {
      const named = model ?? config.model;
      if (named) return tuningOf(named);
      return tuningOf(HOST_FAMILY_PROBE);
    },

    get observedVersion(): string | null {
      return observedVersion;
    },

    get versionDrifted(): boolean {
      return observedVersion !== null && observedVersion !== PINNED_VERSION;
    },

    async init(): Promise<void> {
      observedVersion = await runVersionProbe();
      ready = true;
    },

    async invoke(request: unknown, context?: HostContext): Promise<HostResult> {
      if (!ready) throw new HostNotReadyError(HOST_NAME);

      const req = request as CodexRequest;
      if (!req || typeof req.role !== 'string' || !req.role || typeof req.task !== 'string' || !req.task) {
        throw new InvocationError('A Codex request needs a non-empty role and task', {
          host: HOST_NAME,
          code: 'BAD_REQUEST',
        });
      }

      const id = context?.invocationId ?? `cx-${String(inFlight.size)}-${req.role}`;
      const requestedModel = req.model ?? config.model;
      const args = buildRunArgs(framedTask(req), requestedModel);

      // The role write surface is not wired on this host yet; a coordinator
      // that supplies one must hear that, or the role reads as silently mute.
      const roleEnvSupplied =
        context?.roleEnv !== undefined && context.roleEnv !== null;

      let child: SpawnedProcess;
      try {
        child = spawn(binary, args, { cwd: req.dir ?? config.dir });
      } catch (cause) {
        throw new InvocationError(`Could not start "${binary} exec"`, {
          host: HOST_NAME,
          code: 'HOST_UNAVAILABLE',
          cause,
        });
      }
      inFlight.set(id, child);

      // Not unref'd, checked after the race as well as raced — the same two
      // lessons the other adapters' timeouts carry.
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

        const stream = reduceStream(finished.stdout);

        if (!stream) {
          return {
            id,
            status: 'error',
            output: null,
            error: {
              host: HOST_NAME,
              messages: [
                finished.code === 0
                  ? 'stdout carries no recognisable events — version drift? Run npm run probe:codex.'
                  : `codex exited ${String(finished.code)}`,
              ],
              exitCode: finished.code,
              stderr: finished.stderr.trim() || null,
            },
          };
        }

        if (finished.code !== 0 || stream.errors.length > 0 || !stream.completed) {
          return {
            id,
            status: 'error',
            output: null,
            error: {
              host: HOST_NAME,
              messages: stream.errors.length > 0 ? stream.errors : ['the turn never completed'],
              exitCode: finished.code,
              stderr: finished.stderr.trim() || null,
            },
          };
        }

        const deliverable: CodexDeliverable = {
          role: req.role,
          text: stream.text,
          sessionId: stream.threadId,
          toolCalls: [],
          failedToolCalls: [],
          usage: stream.usage,
          finishReasons: ['turn.completed'],
          notices: roleEnvSupplied
            ? ['this host has no role write surface yet; the role could only talk']
            : [],
          // The stream never names the model (pin: events-never-name-the-model),
          // and an unknown request is refused rather than substituted, so a
          // completed turn's requested name is what ran.
          modelRequested: requestedModel ?? null,
          modelRan: requestedModel ? [requestedModel] : [],
        };

        return { id, status: 'ok', output: deliverable, error: null };
      } finally {
        if (timer) clearTimeout(timer);
        inFlight.delete(id);
        cancelled.delete(id);
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
            detail: `version drift: installed ${version}, pinned ${PINNED_VERSION}. Run npm run probe:codex before trusting a run.`,
          };
        }
        return { live: true, detail: `codex ${version} (pinned)` };
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
