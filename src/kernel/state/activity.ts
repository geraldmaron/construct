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
}

interface Row {
  readonly id: number;
  readonly at: string;
  readonly kind: string;
  readonly run_id: string | null;
  readonly step_run_id: string | null;
  readonly actor: string | null;
  readonly payload_json: string;
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
  },
): ActivityEvent {
  requireInstant(input.at, 'activity.at');
  requireNonEmpty(input.kind, 'activity.kind');
  const row = store.db
    .prepare(
      `INSERT INTO activity_events (at, kind, run_id, step_run_id, actor, payload_json)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(
      input.at,
      input.kind,
      input.runId ?? null,
      input.stepRunId ?? null,
      input.actor ?? null,
      toJson(input.payload ?? {}),
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

/**
 * How often the habits that keep work honest actually happened since a
 * moment: answers checked (and how many came back clean), answers that
 * stated facts unchecked and were caught by a hook, host reads recorded by
 * a hook, and checks a person waived. Counted from the activity log, so it
 * is a measurement, not a setting.
 */
export function habitsSince(store: StateStore, since: string): { answersChecked: number; answersClean: number; uncheckedCaught: number; readsRecorded: number; checksWaived: number } {
  const rows = store.db
    .prepare(
      `SELECT kind, payload_json FROM activity_events
        WHERE at >= ? AND kind IN ('answer.checked', 'hook.answer_unchecked', 'hook.read_reported', 'step.checks_waived')`,
    )
    .all(since) as unknown as { kind: string; payload_json: string }[];
  const out = { answersChecked: 0, answersClean: 0, uncheckedCaught: 0, readsRecorded: 0, checksWaived: 0 };
  for (const r of rows) {
    if (r.kind === 'answer.checked') {
      out.answersChecked += 1;
      if ((parseJson(r.payload_json) as { ok?: boolean } | null)?.ok === true) out.answersClean += 1;
    } else if (r.kind === 'hook.answer_unchecked') out.uncheckedCaught += 1;
    else if (r.kind === 'hook.read_reported') out.readsRecorded += 1;
    else out.checksWaived += 1;
  }
  return out;
}
