/**
 * hosts/session-attach.ts — whether construct serve is already on this
 * session's MCP socket.
 *
 * A file this session will not load is not a wire. Cursor and Claude Code
 * read MCP at session start. Restart and `--yes` leave the conversation.
 * Talk asks the host's own live list; if construct-mcp is not there, it
 * says so and writes nothing.
 */

import { spawnSync } from 'node:child_process';
import type { AmbientHostName } from './ambient.ts';

export const PROJECT_MCP_SERVER_NAME = 'construct-mcp';

export type SessionAttach =
  | { readonly status: 'attached'; readonly host: AmbientHostName }
  | { readonly status: 'unavailable'; readonly host: AmbientHostName };

const LIST_TIMEOUT_MS = 1500;

function hostListProbe(host: AmbientHostName): { command: string; args: readonly string[] } | null {
  if (host === 'cursor') return { command: 'cursor-agent', args: ['mcp', 'list'] };
  if (host === 'claude') return { command: 'claude', args: ['mcp', 'list'] };
  return null;
}

function probeStdout(command: string, args: readonly string[], env: NodeJS.ProcessEnv): string | null {
  try {
    const result = spawnSync(command, [...args], {
      env,
      encoding: 'utf8',
      timeout: LIST_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error !== undefined) return null;
    if (result.status !== 0 || result.stdout === null) return null;
    return result.stdout;
  } catch {
    return null;
  }
}

/** The host's live list names construct-mcp as ready — not merely configured. */
export function listsReadyConstructMcp(text: string): boolean {
  return /construct-mcp\s*:\s*ready\b/i.test(text);
}

/**
 * Whether this session already has construct serve on its socket.
 * A project mcp.json talk could write is not consulted: that file is
 * loaded on the next session, which is leaving.
 */
export function sessionServeAttach(
  host: AmbientHostName,
  env: NodeJS.ProcessEnv = process.env,
): SessionAttach {
  const probe = hostListProbe(host);
  if (probe === null) return { status: 'unavailable', host };
  const stdout = probeStdout(probe.command, probe.args, env);
  if (stdout !== null && listsReadyConstructMcp(stdout)) {
    return { status: 'attached', host };
  }
  return { status: 'unavailable', host };
}
