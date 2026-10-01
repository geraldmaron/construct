/**
 * kernel/state/activity.ts — the append-only record of what happened.
 *
 * The database refuses UPDATE and DELETE on this table; callers can only add.
 */

import type { StateStore } from './open.ts';
import { parseJson, requireInstant, requireNonEmpty, toJson } from './rows.ts';

export interface ActivityEvent {
  readonly id: number;
  readonly at: string;
  readonly kind: string;
  readonly runId: string | null;
  readonly stepRunId: string | null;
  readonly actor: string | null;
  readonly payload: unknown;
  readonly sessionId: string | null;
  readonly agent: string | null;
  readonly channel: string | null;
}

interface Row {
  readonly id: number;
  readonly at: string;
  readonly kind: string;
  readonly run_id: string | null;
  readonly step_run_id: string | null;
  readonly actor: string | null;
  readonly payload_json: string;
  readonly session_id: string | null;
  readonly agent: string | null;
  readonly channel: string | null;
}

function toEvent(row: Row): ActivityEvent {
  return {
    id: row.id,
    at: row.at,
    kind: row.kind,
    runId: row.run_id,
    stepRunId: row.step_run_id,
    actor: row.actor,
    payload: parseJson(row.payload_json),
    sessionId: row.session_id ?? null,
    agent: row.agent ?? null,
    channel: row.channel ?? null,
  };
}

export function appendActivity(
  store: StateStore,
  input: {
    readonly at: string;
    readonly kind: string;
    readonly runId?: string | null;
    readonly stepRunId?: string | null;
    readonly actor?: string | null;
    readonly payload?: unknown;
    /** Overrides the store's current attribution for this one row. */
    readonly channel?: string | null;
    /** The kernel acted on its own, not for the calling session: no session, agent, or channel is recorded. */
    readonly unattributed?: boolean;
  },
): ActivityEvent {
  requireInstant(input.at, 'activity.at');
  requireNonEmpty(input.kind, 'activity.kind');
  const who = input.unattributed ? { sessionId: null, agent: null, channel: null } : store.attribution;
  const row = store.db
    .prepare(
      `INSERT INTO activity_events (at, kind, run_id, step_run_id, actor, payload_json, session_id, agent, channel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(
      input.at,
      input.kind,
      input.runId ?? null,
      input.stepRunId ?? null,
      input.actor ?? null,
      toJson(input.payload ?? {}),
      who.sessionId,
      who.agent,
      input.channel !== undefined ? input.channel : who.channel,
    ) as unknown as Row;
  return toEvent(row);
}

/** Events in insertion order, optionally for one run and after a cursor id. */
export function listActivity(
  store: StateStore,
  filter: { readonly runId?: string; readonly afterId?: number; readonly limit?: number } = {},
): ActivityEvent[] {
  const limit = Math.max(1, Math.min(filter.limit ?? 200, 1000));
  const rows = store.db
    .prepare(
      `SELECT * FROM activity_events
        WHERE (? IS NULL OR run_id = ?) AND id > ?
        ORDER BY id LIMIT ?`,
    )
    .all(filter.runId ?? null, filter.runId ?? null, filter.afterId ?? 0, limit) as unknown as Row[];
  return rows.map(toEvent);
}
