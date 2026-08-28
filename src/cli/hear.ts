/**
 * cli/hear.ts — record ordinary talk as a run, without a tool name.
 *
 * Host prompt-submit hooks (Cursor `beforeSubmitPrompt`, Claude
 * `UserPromptSubmit`) launch this with the user's words on stdin. The host
 * runs the hook; the model does not choose a tool. A pass that only works
 * when someone types `record_outcome` is not this path.
 *
 * Seats come only from a model that actually read the outcome (the host
 * namer), plus declared sources the namer is shown as text. No keyword map,
 * no phrase table, no folder name treated as a catalog domain. `inferredBy`
 * is `namer` only when that model answered. A missing or failed namer
 * stays `none` — keywords do not catch this path.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { detectAmbientHost } from '../hosts/ambient.ts';
import { hostEnvironment, SKIP_HEAR_VAR } from '../hosts/environment.ts';
import { createHostNamer } from '../hosts/namer.ts';
import type { DomainNamer } from '../kernel/implication/naming.ts';
import { mapImplicationsNamed } from '../kernel/implication/naming.ts';
import { startRunSeated } from '../kernel/run/outcome.ts';
import { sourcesFor } from '../kernel/store/sources.ts';
import { storeNamingCache } from '../kernel/store/namings.ts';
import { readWorkLog } from '../kernel/store/worklog.ts';
import type { Store } from '../kernel/store/open.ts';
import { adapterForHost, now, withStoreAsync } from './runtime.ts';

export interface HearOpts {
  /** Hook payload or raw words. Tests inject this; the CLI reads fd 0. */
  readonly stdinText?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Injected; the kernel never reads the clock. */
  readonly now?: () => string;
  /**
   * Injected namer. Tests and a live host that is actually logged in.
   * Absent means try a logged-in host, then stay empty.
   */
  readonly namer?: DomainNamer;
}

function promptFlag(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--prompt=')) return arg.slice('--prompt='.length);
    if (arg === '--prompt') return argv[i + 1];
  }
  return undefined;
}

function readDefaultStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Words a prompt-submit hook (or a test) just handed over.
 *
 * Cursor and Claude both put the user text on `prompt`. Anything else on
 * stdin is treated as the words themselves, not parsed for catalog tokens.
 */
export function wordsFromHookInput(argv: readonly string[], stdinText: string): string {
  const flagged = promptFlag(argv);
  if (flagged !== undefined) return flagged.trim();
  const rest = argv
    .filter((arg) => arg !== '--prompt' && !arg.startsWith('--prompt=') && !arg.startsWith('--'))
    .join(' ')
    .trim();
  if (rest.length > 0) return rest;
  const raw = stdinText.trim();
  if (raw.length === 0) return '';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const prompt = (parsed as { prompt?: unknown }).prompt;
      if (typeof prompt === 'string') return prompt.trim();
    }
  } catch {
    // Not JSON. The hook body is the words.
  }
  return raw;
}

function runForOutcomeText(store: Store, outcome: string): string | undefined {
  for (const entry of readWorkLog(store)) {
    if (entry.action !== 'outcome-received') continue;
    const detail = entry.detail as { outcome?: unknown } | null;
    if (detail !== null && typeof detail.outcome === 'string' && detail.outcome === outcome) {
      return entry.run;
    }
  }
  return undefined;
}

function hookReply(run: string): string {
  return `${JSON.stringify({ continue: true, run })}\n`;
}

function skipHear(env: NodeJS.ProcessEnv): boolean {
  const value = env[SKIP_HEAR_VAR];
  return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';
}

function hostLoggedIn(binary: string, env: NodeJS.ProcessEnv): boolean {
  const run = spawnSync(binary, ['status'], {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: hostEnvironment(env) as NodeJS.ProcessEnv,
  });
  if (run.error || run.status !== 0) return false;
  return !/not logged in/i.test(`${run.stdout}\n${run.stderr}`);
}

function namerSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const chosen = hostEnvironment(env) as NodeJS.ProcessEnv;
  // A hook inherited CURSOR_AGENT / CLAUDECODE. The namer must actually
  // spawn, and must not re-enter this hook.
  delete chosen.CURSOR_AGENT;
  delete chosen.CURSOR_CLI;
  delete chosen.CLAUDECODE;
  delete chosen.CLAUDE_CODE_ENTRYPOINT;
  chosen[SKIP_HEAR_VAR] = '1';
  return chosen;
}

function declaredGround(store: Store): string {
  const sources = sourcesFor(store, 'default');
  if (sources.length === 0) return '';
  const lines = sources.map((source) => `- ${source.kind} ${source.locator}`);
  return `\n\nDeclared sources in reach:\n${lines.join('\n')}`;
}

async function liveNamer(env: NodeJS.ProcessEnv): Promise<{ namer: DomainNamer; host: string } | null> {
  const spawnEnv = namerSpawnEnv(env);
  if (hostLoggedIn('cursor-agent', env)) {
    const host = adapterForHost('cursor', { env: spawnEnv, timeoutMs: 60_000 });
    await host.init();
    return { namer: createHostNamer(host), host: 'cursor' };
  }
  if (hostLoggedIn('claude', env)) {
    const host = adapterForHost('claude', { env: spawnEnv, timeoutMs: 60_000 });
    await host.init();
    return { namer: createHostNamer(host), host: 'claude' };
  }
  return null;
}

/**
 * Record the spoken words as a run. Always allows the host prompt to
 * continue. Creates nothing when there are no words, or when this process
 * is a Construct-spawned host (namer / work), not the user's Send.
 */
export async function hear(argv: readonly string[] = [], opts: HearOpts = {}): Promise<number> {
  const env = opts.env ?? process.env;
  if (skipHear(env)) {
    process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
    return 0;
  }

  const fromArgv = wordsFromHookInput(argv, '');
  const stdinText = fromArgv.length > 0 ? '' : (opts.stdinText ?? readDefaultStdin());
  const words = fromArgv.length > 0 ? fromArgv : wordsFromHookInput([], stdinText);
  if (words.length === 0) {
    process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
    return 0;
  }

  return withStoreAsync(async (store) => {
    const existing = runForOutcomeText(store, words);
    if (existing !== undefined) {
      process.stdout.write(hookReply(existing));
      return 0;
    }

    const at = (opts.now ?? now)();
    const ambient = detectAmbientHost(env);
    const hookHost = ambient === null ? 'hook' : `hook:${ambient.host}`;

    let namer = opts.namer;
    let namerHost = hookHost;
    if (namer === undefined) {
      try {
        const live = await liveNamer(env);
        if (live !== null) {
          namer = live.namer;
          namerHost = `hook:${live.host}`;
        }
      } catch {
        namer = undefined;
      }
    }

    if (namer !== undefined) {
      const reading = `${words}${declaredGround(store)}`;
      const named = await mapImplicationsNamed({
        outcome: words,
        namer: async (_outcome, catalog) => namer(reading, catalog),
        cache: storeNamingCache(store, { host: namerHost, at }),
      });
      // Keywords catching a failed namer is not first-run. Stay empty.
      if (named.namerFailure === undefined && named.inferredBy !== 'keywords') {
        const started = startRunSeated(store, {
          runId: `run-${at.replace(/[-:.TZ]/g, '')}`,
          outcome: words,
          at,
          implicated: named.implicated,
          inferredBy: named.inferredBy,
          host: namerHost,
        });
        process.stdout.write(hookReply(started.runId));
        return 0;
      }
    }

    const started = startRunSeated(store, {
      runId: `run-${at.replace(/[-:.TZ]/g, '')}`,
      outcome: words,
      at,
      implicated: [],
      inferredBy: 'none',
      host: hookHost,
    });
    process.stdout.write(hookReply(started.runId));
    return 0;
  });
}
