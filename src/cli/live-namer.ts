/**
 * cli/live-namer.ts — a logged-in host CLI as Construct's namer.
 *
 * Hear and serve both need the same resolution: if cursor-agent or claude
 * is logged in, build the existing host namer (`createHostNamer`) against
 * that adapter. The kernel never constructs a host. Keywords do not live
 * here. A missing or failed login is null, not a guess.
 *
 * Spawned namer calls strip the ambient session markers and set
 * CONSTRUCT_SKIP_HEAR so a Construct-started host does not re-enter the
 * prompt-submit hook.
 */

import { spawnSync } from 'node:child_process';
import { detectAmbientHost } from '../hosts/ambient.ts';
import { hostEnvironment, SKIP_HEAR_VAR } from '../hosts/environment.ts';
import { createHostNamer } from '../hosts/namer.ts';
import type { DomainNamer } from '../kernel/implication/naming.ts';
import { adapterForHost } from './runtime.ts';

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
  // A hook or MCP serve inherited CURSOR_AGENT / CLAUDECODE. The namer
  // must actually spawn, and must not re-enter the talk hook.
  delete chosen.CURSOR_AGENT;
  delete chosen.CURSOR_CLI;
  delete chosen.CLAUDECODE;
  delete chosen.CLAUDE_CODE_ENTRYPOINT;
  chosen[SKIP_HEAR_VAR] = '1';
  return chosen;
}

export async function resolveLiveNamer(
  env: NodeJS.ProcessEnv,
): Promise<{ namer: DomainNamer; host: string } | null> {
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
 * A DomainNamer that resolves a logged-in host on each call. Throws when
 * none is available so mapImplicationsNamed records a namer failure
 * rather than answering from keywords.
 */
export function liveHostNamer(env: NodeJS.ProcessEnv = process.env): DomainNamer {
  return async (outcome, catalog) => {
    const live = await resolveLiveNamer(env);
    if (live === null) {
      throw new Error('no logged-in host namer');
    }
    return live.namer(outcome, catalog);
  };
}

export function hookHostName(env: NodeJS.ProcessEnv): string {
  const ambient = detectAmbientHost(env);
  return ambient === null ? 'hook' : `hook:${ambient.host}`;
}
