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

/**
 * What an in-session first-run prints when the user has spoken and this
 * session has not yet named the concerns. No run is created here: a hollow
 * record would steal the next `work` and look like staffing happened.
 */
export function sessionNamingPacket(session: AmbientDetection, words?: string): string {
  return (
    `Running inside ${session.host} (detected via ${session.marker}). ` +
    'This session is the namer — the keyword map is not first-run.\n' +
    (words !== undefined && words.length > 0 ? `Words just heard: ${JSON.stringify(words)}\n` : '') +
    'Call MCP record_outcome with namings (catalog domain + why). ' +
    'An empty namings array is a real answer that this implicates nothing.\n' +
    'Then claim_task / submit_work on construct serve. Do not spawn a second CLI.\n'
  );
}

/** A recorded run that never received namings is not "no outcome yet". */
export function unnamedRunMessage(run: string): string {
  return (
    `run ${run} is on record but has no named work — nothing to dispatch.\n` +
    'This session names via MCP record_outcome with namings, or construct outcome --domains=<name,…>.\n'
  );
}
