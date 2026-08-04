/**
 * hosts/claude/adapter.ts — the Claude Code CLI behind the host adapter seam:
 * the second host, and therefore the proof that host independence is real
 * rather than asserted (construct-r67.4, commitment 1).
 *
 * Same shape and same restraint as hosts/opencode/adapter.ts: spawn
 * `claude -p --output-format json`, read one envelope back, reimplement
 * nothing the host already owns (sessions, retries, tool brokering, model
 * routing). The differences are the host's, and they are written down:
 *
 *   - No warm-up and no first-run gate. OpenCode's cold sqlite migration has
 *     no counterpart here; the CLI's own state is not this adapter's problem.
 *   - Cost is real. The envelope reports total_cost_usd and num_turns, so the
 *     spend ceiling binds on this host — the OpenCode/ollama path reports
 *     zero out of zero measurements and is honestly "unmeasured" instead.
 *   - The --model flag is a preference, not a constraint (pin.ts records the
 *     measurement: an unknown model name ran the session default, opus, at
 *     13x the requested tier's price). The deliverable therefore carries
 *     modelRequested and modelRan, and kernel accountability turns a mismatch
 *     into a flagged concern rather than trusting the flag.
 *   - The single-envelope format carries no per-tool events, so toolCalls is
 *     always empty; permission_denials (tool uses the host refused) map to
 *     failedToolCalls, which is what they are from the kernel's side. Not
 *     declaring 'stream' covers the rest, same as the OpenCode adapter.
 *   - This is the host that launches the role's write surface. Given a
 *     `context.roleEnv`, it registers `construct role-serve` as an MCP server
 *     for the invocation (mcpconfig.ts) and allow-lists exactly the two role
 *     tools; given none, it registers nothing and the role can only talk.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { hostEnvironment, roleServeEnvironment } from '../environment.ts';
import type { HostAdapter, HostCancellation, HostCapability, HostContext, HostHealth, HostResult } from '../../kernel/hosts/interface.ts';
import { HostNotReadyError, InvocationError, InvocationTimeoutError } from '../../kernel/hosts/errors.ts';
import { modelDrifted, reduceEnvelope } from './result.ts';
import type { ClaudeUsage } from './result.ts';
import { PINNED_VERSION, tierOfModel } from './pin.ts';
import type { ModelTier } from '../../kernel/brief/tiers.ts';
import { mcpArgsFor, writeMcpConfig } from './mcpconfig.ts';
import type { RoleServeLaunch } from './mcpconfig.ts';

export const HOST_NAME = 'claude';

/** Killing the child genuinely interrupts; runs share nothing in-process. */
export const CLAUDE_CAPABILITIES: readonly HostCapability[] = ['interrupt', 'concurrent'];

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface SpawnedProcess {
  readonly done: Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }>;
  kill(): void;
}

export type ClaudeSpawnFn = (
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string },
) => SpawnedProcess;

export interface ClaudeConfig {
  /** Resolved via PATH when relative. */
  readonly binary?: string;
  /** Model name or alias, e.g. `haiku`. See pin.ts: a preference, not a constraint. */
  readonly model?: string;
  readonly dir?: string;
  readonly timeoutMs?: number;
  readonly spawn?: ClaudeSpawnFn;
  /**
   * How to launch `construct role-serve` as this host's MCP server. Only used
   * when the coordinator supplies a role env; absent that, no server is
   * registered and the role has no write surface — safe rather than broken.
   */
  readonly roleServe?: RoleServeLaunch;
}

export interface ClaudeRequest {
  readonly role: string;
  readonly task: string;
  readonly model?: string;
  readonly dir?: string;
}

/** Same keys as the OpenCode deliverable — that parity is the point. */
export interface ClaudeDeliverable {
  readonly role: string;
  readonly text: string;
  readonly sessionId: string | null;
  readonly toolCalls: readonly unknown[];
  readonly failedToolCalls: readonly unknown[];
  readonly usage: ClaudeUsage;
  readonly finishReasons: readonly string[];
  readonly notices: readonly string[];
  /** What was asked for and what served it — accountability for silent fallback. */
  readonly modelRequested: string | null;
  readonly modelRan: readonly string[];
}

export interface ClaudeAdapter extends HostAdapter {
  readonly pinnedVersion: string;
  readonly observedVersion: string | null;
  readonly versionDrifted: boolean;
}

function defaultSpawn(command: string, args: readonly string[], options: { cwd?: string }): SpawnedProcess {
  const child = nodeSpawn(command, [...args], {
    cwd: options.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Chosen, not inherited: construct's own XDG isolation must not
    // re-point the host's configuration and credentials (construct-wl8).
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

function buildRunArgs(request: ClaudeRequest, config: ClaudeConfig): string[] {
  const args = ['-p', request.task, '--output-format', 'json'];
  const model = request.model ?? config.model;
  if (model) args.push('--model', model);
  return args;
}

/**
 * HostContext is an open bag (`[key: string]: unknown`), so roleEnv arrives
 * untyped. Narrow it here rather than casting: a malformed entry would end up
 * as `undefined` in the server's environment, which reads at the far end as a
 * missing scope rather than as the bug it is.
 */
function readRoleEnvFrom(context: HostContext | undefined): Record<string, string> | null {
  const candidate = context?.roleEnv;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const entries = Object.entries(candidate as Record<string, unknown>);
  if (entries.length === 0) return null;
  if (!entries.every(([, value]) => typeof value === 'string')) {
    throw new InvocationError('roleEnv must map names to strings', {
      host: HOST_NAME,
      code: 'BAD_REQUEST',
    });
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

/** Same framing rule as the OpenCode adapter: the role is stated in the prompt. */
function framedTask(request: ClaudeRequest): string {
  return `You are acting as: ${request.role}.\n\n${request.task}`;
}

export function createClaudeAdapter(config: ClaudeConfig = {}): ClaudeAdapter {
  const binary = config.binary ?? 'claude';
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
      throw new InvocationError(`Could not start "${binary}": is Claude Code installed and on PATH?`, {
        host: HOST_NAME,
        code: 'HOST_UNAVAILABLE',
        cause,
      });
    }
    const result = await probe.done.catch((cause: unknown) => {
      throw new InvocationError(`Could not start "${binary}": is Claude Code installed and on PATH?`, {
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

  const adapter: ClaudeAdapter = {
    name: HOST_NAME,
    kind: 'coding',
    capabilities: CLAUDE_CAPABILITIES,
    pinnedVersion: PINNED_VERSION,

    /** The model every dispatch will request unless the request overrides it. */
    get model(): string | null {
      return config.model ?? null;
    },

    /**
     * Tier membership is the pin's to declare (construct-ap0). Note the pin's
     * own recorded measurement: --model is a preference, not a constraint here,
     * so an unknown name runs the session default. That is exactly why null is
     * returned for anything unrecognised rather than a guess.
     */
    modelTier(model?: string): ModelTier | null {
      return tierOfModel(model ?? config.model);
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

      const req = request as ClaudeRequest;
      if (!req || typeof req.role !== 'string' || !req.role || typeof req.task !== 'string' || !req.task) {
        throw new InvocationError('A Claude request needs a non-empty role and task', {
          host: HOST_NAME,
          code: 'BAD_REQUEST',
        });
      }

      const id = context?.invocationId ?? `cl-${String(inFlight.size)}-${req.role}`;
      const args = buildRunArgs({ ...req, task: framedTask(req) }, config);
      const requestedModel = req.model ?? config.model;

      // The role's write surface. The config goes to a 0600 file and only the
      // PATH reaches argv, because argv is ps-visible and the bearer is not
      // allowed to be (see mcpconfig.ts). Written before the spawn and removed
      // in the finally below, so no exit path leaves it on disk.
      const roleEnv = readRoleEnvFrom(context);
      const mcp = roleEnv
        ? writeMcpConfig(roleEnv, {
            ...config.roleServe,
            // Same reasoning as the OpenCode adapter: the role server is
            // construct's own code and must land on construct's store, which
            // the host child's stripped environment would not resolve to.
            env: { ...roleServeEnvironment(), ...config.roleServe?.env },
          })
        : null;
      if (mcp) args.push(...mcpArgsFor(mcp.path));

      let child: SpawnedProcess;
      try {
        child = spawn(binary, args, { cwd: req.dir ?? config.dir });
      } catch (cause) {
        mcp?.dispose();
        throw new InvocationError(`Could not start "${binary} -p"`, {
          host: HOST_NAME,
          code: 'HOST_UNAVAILABLE',
          cause,
        });
      }
      inFlight.set(id, child);

      // Not unref'd, checked after the race as well as raced — the same two
      // lessons the OpenCode adapter's timeout carries (construct-byd).
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
          return {
            id,
            status: 'error',
            output: null,
            error: {
              host: HOST_NAME,
              messages: [
                finished.code === 0
                  ? 'stdout is not a result envelope — version drift? Run npm run probe:claude.'
                  : `claude exited ${String(finished.code)}`,
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

        const drifted = modelDrifted(requestedModel, envelope.modelsRan);
        const deliverable: ClaudeDeliverable = {
          role: req.role,
          text: envelope.text,
          sessionId: envelope.sessionId,
          toolCalls: [],
          failedToolCalls: envelope.permissionDenials,
          usage: envelope.usage,
          finishReasons: envelope.stopReason ? [envelope.stopReason] : [],
          notices: drifted
            ? [`requested model "${String(requestedModel)}" but the host ran ${envelope.modelsRan.join(', ')}`]
            : [],
          modelRequested: requestedModel ?? null,
          modelRan: envelope.modelsRan,
        };

        return { id, status: 'ok', output: deliverable, error: null };
      } finally {
        if (timer) clearTimeout(timer);
        mcp?.dispose();
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
            detail: `version drift: installed ${version}, pinned ${PINNED_VERSION}. Run npm run probe:claude before trusting a run.`,
          };
        }
        return { live: true, detail: `claude ${version} (pinned)` };
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
