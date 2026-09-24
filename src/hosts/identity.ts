/**
 * hosts/identity.ts — what a host says about the session Construct runs in,
 * read from its environment at the adapter edge.
 *
 * Construct mints the session id that carries authority. A host's own session
 * id is only an attribute: it lets a restarted server find its predecessor's
 * work and joins Construct's records to the host's transcripts. Any process
 * running as the same user can set these variables, so nothing keyed on them
 * ever grants, approves, or owns anything.
 *
 * Each key is one observed on this machine in the host's MCP server
 * environment (2026-09-24), not a documented contract: Claude Code sets
 * CLAUDE_CODE_SESSION_ID to the session whose transcript file carries the same
 * id; Cursor's agent worker sets CURSOR_AGENT_WORKER_ID. A host with no such
 * variable is identified by its initialize clientInfo alone.
 */

export const IDENTITY_ENV_KEYS = ['CLAUDE_CODE_SESSION_ID', 'CURSOR_AGENT_WORKER_ID'] as const;

export interface HostIdentity {
  /** The host's own id for this session. */
  readonly hostSessionId: string;
  /** The variable it came from, so the record says how it is known. */
  readonly source: (typeof IDENTITY_ENV_KEYS)[number];
}

const PLAUSIBLE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** The host's session id from `env`, or null. Values that do not look like an id are ignored. */
export function readHostIdentity(env: NodeJS.ProcessEnv): HostIdentity | null {
  for (const key of IDENTITY_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value && PLAUSIBLE_ID.test(value)) return { hostSessionId: value, source: key };
  }
  return null;
}
