/**
 * hosts/session.ts — whether this process is already inside a host that
 * should execute the work itself, rather than being spawned as a second CLI.
 *
 * Spawning `cursor-agent` from a process that Cursor already launched is a
 * second runtime. The same is true of Claude Code, Codex, OpenCode, and Bob.
 * In-session dispatch is host-pull: the session that is already running claims
 * a task through `construct serve` and submits a draft. Construct owns the
 * log, the inbox, and completion. This module only answers the one question
 * `work` has to get right before it creates an adapter: should this invocation
 * spawn, or hand the work to the session it is already in?
 */

import { detectAmbientHost } from './ambient.ts';
import type { AmbientDetection, AmbientHostName } from './ambient.ts';

export type { AmbientDetection, AmbientHostName };

/**
 * Whether `work` should spawn a host CLI for this invocation.
 *
 * False when the process is already inside the host that would be spawned —
 * an explicit `--binary` is the one override, because a path to an executable
 * is a request to run that executable. A typed `--host` that names the
 * ambient session is still the session, not a request for a second process.
 */
export function shouldSpawnHost(
  host: string,
  env: NodeJS.ProcessEnv,
  opts: { readonly hostExplicit: boolean; readonly binary?: string } = { hostExplicit: false },
): boolean {
  if (opts.binary !== undefined) return true;
  const ambient = detectAmbientHost(env);
  if (ambient === null) return true;
  if (!opts.hostExplicit) return false;
  return ambient.host !== host;
}

/** The ambient host this process should dispatch through, when it should not spawn. */
export function sessionDispatchHost(env: NodeJS.ProcessEnv): AmbientDetection | null {
  return detectAmbientHost(env);
}

/**
 * Whether this invocation of `work` (or `outcome`) is in-session dispatch:
 * an ambient host is present and nothing asked for a different spawn.
 */
export function usesSessionDispatch(
  env: NodeJS.ProcessEnv,
  opts: { readonly host?: string; readonly hostExplicit: boolean; readonly binary?: string },
): AmbientDetection | null {
  if (opts.binary !== undefined) return null;
  const ambient = detectAmbientHost(env);
  if (ambient === null) return null;
  if (opts.hostExplicit && opts.host !== undefined && opts.host !== ambient.host) return null;
  return ambient;
}
