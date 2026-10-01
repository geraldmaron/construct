/**
 * kernel/state/sessions.ts — who is working in this project.
 *
 * Every MCP server that binds registers a session under an id Construct mints.
 * What the host says about itself (its own session id, its client name and
 * version) is kept as labeled attributes; none of it grants anything. A
 * session is live until it ends; how long ago it last called Construct is what
 * other sessions see as its presence, and what lets its claims be taken over
 * once it has gone quiet.
 */

import type { StateStore } from './open.ts';
import { requireInstant, requireNonEmpty } from './rows.ts';

export const SESSION_SURFACES = ['interactive', 'headless', 'cli', 'hook'] as const;
export type SessionSurface = (typeof SESSION_SURFACES)[number];

export interface SessionRecord {
  readonly id: string;
  readonly host: string;
  readonly surface: SessionSurface;
  readonly hostSessionId: string | null;
  readonly hostSessionSource: string | null;
  readonly clientName: string | null;
  readonly clientVersion: string | null;
  readonly machine: string;
  readonly pid: number | null;
  readonly serveVersion: string | null;
  readonly laneRoot: string | null;
  readonly branch: string | null;
  readonly startedAt: string;
  readonly lastSeenAt: string;
  readonly endedAt: string | null;
  readonly endReason: string | null;
}

interface Row {
  readonly id: string;
  readonly host: string;
  readonly surface: SessionSurface;
  readonly host_session_id: string | null;
  readonly host_session_source: string | null;
  readonly client_name: string | null;
  readonly client_version: string | null;
  readonly machine: string;
  readonly pid: number | null;
  readonly serve_version: string | null;
  readonly lane_root: string | null;
  readonly branch: string | null;
  readonly started_at: string;
  readonly last_seen_at: string;
  readonly ended_at: string | null;
  readonly end_reason: string | null;
}

function toSession(row: Row): SessionRecord {
  return {
    id: row.id,
    host: row.host,
    surface: row.surface,
    hostSessionId: row.host_session_id,
    hostSessionSource: row.host_session_source,
    clientName: row.client_name,
    clientVersion: row.client_version,
    machine: row.machine,
    pid: row.pid,
    serveVersion: row.serve_version,
    laneRoot: row.lane_root,
    branch: row.branch,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    endedAt: row.ended_at,
    endReason: row.end_reason,
  };
}

export interface RegisterSessionInput {
  readonly id: string;
  readonly host: string;
  readonly surface: SessionSurface;
  readonly machine: string;
  readonly at: string;
  readonly pid?: number;
  readonly hostSessionId?: string;
  readonly hostSessionSource?: string;
  readonly serveVersion?: string;
  readonly laneRoot?: string;
  readonly branch?: string;
  readonly head?: string;
}

/** Register a session. It starts watching other sessions' activity from now, not from the beginning. */
export function registerSession(store: StateStore, input: RegisterSessionInput): SessionRecord {
  requireNonEmpty(input.id, 'session.id');
  requireInstant(input.at, 'session.at');
  return store.transaction(() => {
    store.db
      .prepare(
        `INSERT INTO sessions (id, host, surface, host_session_id, host_session_source, machine, pid, serve_version, lane_root, branch, head, started_at, last_seen_at, activity_cursor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(id), 0) FROM activity_events))`,
      )
      .run(
        input.id, input.host, input.surface, input.hostSessionId ?? null, input.hostSessionSource ?? null, input.machine,
        input.pid ?? null, input.serveVersion ?? null, input.laneRoot ?? null, input.branch ?? null, input.head ?? null, input.at, input.at,
      );
    return getSession(store, input.id)!;
  });
}

/** What the host's MCP client said about itself at initialize. Descriptive only. */
export function recordClient(store: StateStore, input: { readonly id: string; readonly name: string | null; readonly version: string | null; readonly at: string }): void {
  store.db
    .prepare(`UPDATE sessions SET client_name = ?, client_version = ?, last_seen_at = ? WHERE id = ?`)
    .run(input.name?.slice(0, 120) ?? null, input.version?.slice(0, 60) ?? null, input.at, input.id);
}

/** The session called Construct at `at`. */
export function touchSession(store: StateStore, input: { readonly id: string; readonly at: string }): void {
  store.db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ? AND ended_at IS NULL`).run(input.at, input.id);
}

export function endSession(store: StateStore, input: { readonly id: string; readonly at: string; readonly reason: string }): void {
  store.db
    .prepare(`UPDATE sessions SET ended_at = ?, end_reason = ?, last_seen_at = ? WHERE id = ? AND ended_at IS NULL`)
    .run(input.at, input.reason, input.at, input.id);
}

export function getSession(store: StateStore, id: string): SessionRecord | null {
  const row = store.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Row | undefined;
  return row ? toSession(row) : null;
}

/** Sessions that have not ended and called Construct at or after `seenSince`, most recent first. */
export function listLiveSessions(store: StateStore, seenSince: string): SessionRecord[] {
  const rows = store.db
    .prepare(`SELECT * FROM sessions WHERE ended_at IS NULL AND last_seen_at >= ? ORDER BY last_seen_at DESC, id`)
    .all(seenSince) as unknown as Row[];
  return rows.map(toSession);
}

/** Note an agent seen inside a session. `attestation` says whether the host vouched for it. */
export function recordAgent(
  store: StateStore,
  input: { readonly sessionId: string; readonly agent: string; readonly attestation: 'host' | 'reported'; readonly at: string; readonly laneRoot?: string; readonly hostAgentId?: string; readonly agentType?: string },
): void {
  store.db
    .prepare(
      `INSERT INTO session_agents (session_id, agent, host_agent_id, agent_type, attestation, lane_root, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (session_id, agent) DO UPDATE SET last_seen_at = excluded.last_seen_at,
         attestation = CASE WHEN session_agents.attestation = 'host' THEN 'host' ELSE excluded.attestation END`,
    )
    .run(input.sessionId, input.agent, input.hostAgentId ?? null, input.agentType ?? null, input.attestation, input.laneRoot ?? null, input.at, input.at);
}
