/**
 * hosts/cursor/adapter.ts — the Cursor CLI behind the host adapter seam: the
 * fourth host, the second that spends a subscription, and the first that
 * serves many vendors' model families through one binary.
 *
 * Same shape and same restraint as the other adapters: spawn
 * `cursor-agent -p --output-format json`, read one envelope back,
 * reimplement nothing the host already owns. The differences are the host's,
 * and they are written down in pin.ts as probed expectations:
 *
 *   - Dispatch runs in plan mode. `-p` alone grants the agent write and
 *     shell access, and a review role must not have either; `--mode plan` is
 *     the probed read-only posture, so the role can only read and reply.
 *   - Workspace trust is granted per invocation (`--trust`) and the
 *     workspace is the task directory, so the grant covers exactly what the
 *     dispatch is reviewing and nothing else.
 *   - The --model flag is a constraint, not a preference: an unknown name is
 *     refused with the catalog echoed back, never silently substituted.
 *   - Family membership is per named model, not per host. This binary serves
 *     claude, gpt, gemini and more, so a named model resolves through the
 *     shared tuning table and an unnamed one honestly belongs to no family —
 *     untuned, best-effort, labeled, and still run. An unoptimized family
 *     functions; the label is the only difference.
 *   - Cost is unmeasured, not zero: the envelope reports token counts and no
 *     dollars.
 *   - No role write surface yet, same as the Codex host: a dispatch that
 *     supplies roleEnv gets a notice rather than a silently mute role.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { hostEnvironment } from '../environment.ts';
import type { HostAdapter, HostCancellation, HostCapability, HostContext, HostHealth, HostResult, ModelTuning } from '../../kernel/hosts/interface.ts';
import { HostNotReadyError, InvocationError, InvocationTimeoutError } from '../../kernel/hosts/errors.ts';
import { reduceEnvelope } from './result.ts';
import type { CursorUsage } from './result.ts';
import { PINNED_VERSION, tierOfModel } from './pin.ts';
import { tuningOf } from '../tuning.ts';
import type { ModelTier } from '../../kernel/brief/tiers.ts';
import { frameHostTask } from '../../kernel/voice/voice.ts';
import { redact } from '../../kernel/render/redact.ts';

export const HOST_NAME = 'cursor';

/** Killing the child genuinely interrupts; runs share nothing in-process. */
/**
 * No `outward-write`: dispatch runs `--mode plan`, probed read-only, so a
 * model here cannot act on anything outside the process however it is asked.
 */
export const CURSOR_CAPABILITIES: readonly HostCapability[] = ['interrupt', 'concurrent'];

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface SpawnedProcess {
  readonly done: Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }>;
  kill(): void;
}

export type CursorSpawnFn = (
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string },
) => SpawnedProcess;

export interface CursorConfig {
  /** Resolved via PATH when relative. */
  readonly binary?: string;
  /** Model name from the host's catalog. See pin.ts: a constraint, not a preference. */
  readonly model?: string;
  readonly dir?: string;
  readonly timeoutMs?: number;
  readonly spawn?: CursorSpawnFn;
  /**
   * Environment used to decide in-session dispatch. Injected so a test can
   * prove the spawn path without inheriting the runner's CURSOR_AGENT, and so
   * `work` can pass the env it already detected from.
   */
  readonly env?: NodeJS.ProcessEnv;
}

export interface CursorRequest {
  readonly role: string;
  readonly task: string;
  readonly model?: string;
  readonly dir?: string;
}

/** Same keys as the other hosts' deliverables — that parity is the point. */
export interface CursorDeliverable {
  readonly role: string;
  readonly text: string;
  readonly sessionId: string | null;
  readonly toolCalls: readonly unknown[];
  readonly failedToolCalls: readonly unknown[];
  readonly usage: CursorUsage;
  readonly finishReasons: readonly string[];
  readonly notices: readonly string[];
  readonly modelRequested: string | null;
  readonly modelRan: readonly string[];
}

export interface CursorAdapter extends HostAdapter {
  readonly pinnedVersion: string;
  readonly observedVersion: string | null;
  readonly versionDrifted: boolean;
}

function defaultSpawn(command: string, args: readonly string[], options: { cwd?: string }): SpawnedProcess {
  const child = nodeSpawn(command, [...args], {
    cwd: options.cwd,
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
    // A child is spawned with the ambient environment, so a verbose auth
    // failure can print a provider key on stderr. Strip credential shapes here,
    // once, before the stream reaches any record or screen downstream.
    child.on('close', (code) => resolve({ code, stdout, stderr: redact(stderr) }));
  });
  return { done, kill: () => void child.kill('SIGTERM') };
}

function buildRunArgs(task: string, model: string | undefined): string[] {
  // Plan mode before everything: -p alone grants write and shell, which a
  // review dispatch must never hold (pin: plan-mode-is-read-only).
  const args = ['-p', '--mode', 'plan', '--trust', '--output-format', 'json'];
  if (model) args.push('--model', model);
  args.push(task);
  return args;
}

/** Same framing rule as every other adapter, and it is written in one place. */
function framedTask(request: CursorRequest): string {
  return frameHostTask(request);
}

function cursorSessionMarker(env: NodeJS.ProcessEnv): string | null {
  if (env.CURSOR_AGENT !== undefined) return 'CURSOR_AGENT';
  if (env.CURSOR_CLI !== undefined) return 'CURSOR_CLI';
  return null;
}

export function createCursorAdapter(config: CursorConfig = {}): CursorAdapter {
  const binary = config.binary ?? 'cursor-agent';
  const spawn = config.spawn ?? defaultSpawn;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = config.env ?? process.env;
  const sessionMarker = cursorSessionMarker(env);
  const inFlight = new Map<string, SpawnedProcess>();
  const cancelled = new Set<string>();

  let ready = false;
  let observedVersion: string | null = null;

  async function runVersionProbe(): Promise<string> {
    let probe: SpawnedProcess;
    try {
      probe = spawn(binary, ['--version'], {});
    } catch (cause) {
      throw new InvocationError(`Could not start "${binary}": is the Cursor CLI installed and on PATH?`, {
        host: HOST_NAME,
        code: 'HOST_UNAVAILABLE',
        cause,
      });
    }
    const result = await probe.done.catch((cause: unknown) => {
      throw new InvocationError(`Could not start "${binary}": is the Cursor CLI installed and on PATH?`, {
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

  const adapter: CursorAdapter = {
    name: HOST_NAME,
    kind: 'coding',
    capabilities: CURSOR_CAPABILITIES,
    pinnedVersion: PINNED_VERSION,

    /** The model every dispatch will request unless the request overrides it. */
    get model(): string | null {
      return config.model ?? null;
    },

    /** The wall every invocation runs into, stated so a caller can report it. */
    invocationTimeoutMs: timeoutMs,

    /**
     * Tier membership is the pin's to declare; null for an unrecognised name
     * means "no tier claim", and on this host an unknown name will also be
     * refused at dispatch (unknown-model-fails-hard).
     */
    modelTier(model?: string): ModelTier | null {
      return tierOfModel(model ?? config.model);
    },

    /**
     * Multi-vendor catalog, so the family is the named model's and nothing
     * else's. Unnamed means genuinely no family — untuned and best-effort —
     * because guessing a family here would attach one vendor's tuning
     * evidence to another vendor's output. Untuned is a label, never a
     * refusal: the dispatch runs either way.
     */
    modelTuning(model?: string): ModelTuning {
      const named = model ?? config.model;
      return tuningOf(named ?? null);
    },

    get observedVersion(): string | null {
      return observedVersion;
    },

    get versionDrifted(): boolean {
      return observedVersion !== null && observedVersion !== PINNED_VERSION;
    },

    async init(): Promise<void> {
      // Already inside Cursor: probing `cursor-agent --version` starts a
      // second runtime that is not this session, and on machines where the
      // CLI is not on PATH it fails the whole run. In-session dispatch does
      // not spawn.
      if (sessionMarker !== null && config.binary === undefined) {
        observedVersion = `in-session (${sessionMarker})`;
        ready = true;
        return;
      }
      observedVersion = await runVersionProbe();
      ready = true;
    },

    async invoke(request: unknown, context?: HostContext): Promise<HostResult> {
      if (!ready) throw new HostNotReadyError(HOST_NAME);
      if (sessionMarker !== null && config.binary === undefined) {
        throw new InvocationError(
          `This process is already inside Cursor (${sessionMarker}). ` +
            'Spawning cursor-agent would be a second runtime. ' +
            'Dispatch through construct serve (claim_task / submit_work).',
          { host: HOST_NAME, code: 'HOST_UNAVAILABLE' },
        );
      }

      const req = request as CursorRequest;
      if (!req || typeof req.role !== 'string' || !req.role || typeof req.task !== 'string' || !req.task) {
        throw new InvocationError('A Cursor request needs a non-empty role and task', {
          host: HOST_NAME,
          code: 'BAD_REQUEST',
        });
      }

      const id = context?.invocationId ?? `cu-${String(inFlight.size)}-${req.role}`;
      const requestedModel = req.model ?? config.model;
      const args = buildRunArgs(framedTask(req), requestedModel);

      const roleEnvSupplied = context?.roleEnv !== undefined && context.roleEnv !== null;

      let child: SpawnedProcess;
      try {
        child = spawn(binary, args, { cwd: req.dir ?? config.dir });
      } catch (cause) {
        throw new InvocationError(`Could not start "${binary} -p"`, {
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

        const envelope = reduceEnvelope(finished.stdout);

        if (!envelope) {
          // The host states its refusals on stderr in plain language (usage
          // limit, auth expiry); the first line of that beats a bare exit
          // code, which is all a work-log reader would otherwise see.
          const hostSaid = finished.stderr
            .split('\n')
            .map((l) => l.trim())
            .find((l) => l.length > 0);
          return {
            id,
            status: 'error',
            output: null,
            error: {
              host: HOST_NAME,
              messages: [
                finished.code === 0
                  ? 'stdout is not a result envelope — version drift? Run npm run probe:cursor.'
                  : (hostSaid ?? `cursor-agent exited ${String(finished.code)}`),
              ],
              exitCode: finished.code,
              stderr: finished.stderr.trim() || null,
            },
          };
        }

        if (envelope.isError || envelope.subtype !== 'success' || finished.code !== 0) {
          return {
            id,
            status: 'error',
            output: null,
            error: {
              host: HOST_NAME,
              messages: [envelope.subtype, envelope.text].filter(Boolean),
              exitCode: finished.code,
              stderr: finished.stderr.trim() || null,
            },
          };
        }

        const deliverable: CursorDeliverable = {
          role: req.role,
          text: envelope.text,
          sessionId: envelope.sessionId,
          toolCalls: [],
          failedToolCalls: [],
          usage: envelope.usage,
          finishReasons: [envelope.subtype],
          notices: roleEnvSupplied
            ? ['this host has no role write surface yet; the role could only talk']
            : [],
          // The envelope never names the model (pin: envelope-never-names-the-
          // model), and an unknown request is refused rather than substituted,
          // so a successful envelope's requested name is what ran.
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
            detail: `version drift: installed ${version}, pinned ${PINNED_VERSION}. Run npm run probe:cursor before trusting a run.`,
          };
        }
        return { live: true, detail: `cursor-agent ${version} (pinned)` };
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
