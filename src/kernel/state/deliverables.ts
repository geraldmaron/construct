/**
 * kernel/state/deliverables.ts — deliverable trust state machine for format v1.
 *
 * none → draft → reviewed|challenged → accepted|final
 *
 * Submitting completed work creates or updates a draft. It never promotes.
 */

import type { StateStore } from './open.ts';

export const TRUST_STATES = [
  'none',
  'draft',
  'reviewed',
  'challenged',
  'accepted',
  'final',
] as const;
export type TrustState = (typeof TRUST_STATES)[number];

export interface Deliverable {
  readonly id: string;
  readonly taskId: string;
  readonly runId: string;
  readonly trustState: TrustState;
  readonly body: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface Row {
  readonly id: string;
  readonly task_id: string;
  readonly run_id: string;
  readonly trust_state: TrustState;
  readonly body_json: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function toDeliverable(row: Row): Deliverable {
  return {
    id: row.id,
    taskId: row.task_id,
    runId: row.run_id,
    trustState: row.trust_state,
    body: parseJson(row.body_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getDeliverableByTask(store: StateStore, taskId: string): Deliverable | null {
  const row = store.db
    .prepare('SELECT * FROM deliverables WHERE task_id = ?')
    .get(taskId) as Row | undefined;
  return row ? toDeliverable(row) : null;
}

const TRUST_TRANSITIONS: Readonly<Record<TrustState, readonly TrustState[]>> = {
  none: ['draft'],
  draft: ['reviewed', 'challenged', 'accepted'],
  reviewed: ['accepted', 'challenged', 'final'],
  challenged: ['draft', 'accepted', 'reviewed'],
  accepted: ['final'],
  final: [],
};

/**
 * Move a deliverable's trust state. Submitting work never calls this —
 * only an explicit human judgment (inbox decide / verdict / trust).
 */
export function setTrustState(
  store: StateStore,
  input: {
    readonly taskId: string;
    readonly trustState: TrustState;
    readonly at: string;
    readonly by: string;
    readonly decisionId?: string;
  },
): Deliverable {
  const existing = getDeliverableByTask(store, input.taskId);
  if (!existing) {
    throw new Error(`no deliverable for task ${input.taskId}`);
  }
  const allowed = TRUST_TRANSITIONS[existing.trustState];
  if (!allowed.includes(input.trustState)) {
    throw new Error(
      `deliverable for task ${input.taskId} cannot move from ${existing.trustState} to ${input.trustState}`,
    );
  }
  store.db
    .prepare(
      `UPDATE deliverables SET trust_state = ?, updated_at = ? WHERE task_id = ?`,
    )
    .run(input.trustState, input.at, input.taskId);
  appendActivity(store, {
    at: input.at,
    kind: 'deliverable.trust',
    runId: existing.runId,
    taskId: input.taskId,
    payload: {
      from: existing.trustState,
      to: input.trustState,
      by: input.by,
      decisionId: input.decisionId ?? null,
    },
  });
  const updated = getDeliverableByTask(store, input.taskId);
  if (!updated) throw new Error('trust update failed');
  return updated;
}

/**
 * Upsert a draft body for a task. Trust stays draft; never jumps to accepted.
 */
export function upsertDraft(
  store: StateStore,
  input: {
    readonly id: string;
    readonly taskId: string;
    readonly runId: string;
    readonly body: unknown;
    readonly at: string;
  },
): Deliverable {
  const existing = getDeliverableByTask(store, input.taskId);
  if (existing) {
    if (existing.trustState === 'accepted' || existing.trustState === 'final') {
      throw new Error(`deliverable for task ${input.taskId} is ${existing.trustState}; drafts cannot overwrite it`);
    }
    store.db
      .prepare(
        `UPDATE deliverables
            SET body_json = ?, trust_state = 'draft', updated_at = ?
          WHERE task_id = ?`,
      )
      .run(JSON.stringify(input.body ?? null), input.at, input.taskId);
  } else {
    store.db
      .prepare(
        `INSERT INTO deliverables (id, task_id, run_id, trust_state, body_json, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
      )
      .run(
        input.id,
        input.taskId,
        input.runId,
        JSON.stringify(input.body ?? null),
        input.at,
        input.at,
      );
  }
  const row = getDeliverableByTask(store, input.taskId);
  if (!row) throw new Error('draft upsert failed');
  return row;
}

export function appendActivity(
  store: StateStore,
  input: {
    readonly at: string;
    readonly kind: string;
    readonly runId?: string;
    readonly taskId?: string;
    readonly payload: unknown;
  },
): void {
  store.db
    .prepare(
      `INSERT INTO activity_events (at, kind, run_id, task_id, payload)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.at,
      input.kind,
      input.runId ?? null,
      input.taskId ?? null,
      JSON.stringify(input.payload ?? null),
    );
}

export interface ActivityEvent {
  readonly id: number;
  readonly at: string;
  readonly kind: string;
  readonly runId: string | null;
  readonly taskId: string | null;
  readonly payload: unknown;
}

interface ActivityRow {
  readonly id: number;
  readonly at: string;
  readonly kind: string;
  readonly run_id: string | null;
  readonly task_id: string | null;
  readonly payload: string | null;
}

function toActivity(row: ActivityRow): ActivityEvent {
  let payload: unknown = null;
  if (row.payload !== null) {
    try {
      payload = JSON.parse(row.payload);
    } catch {
      payload = row.payload;
    }
  }
  return {
    id: row.id,
    at: row.at,
    kind: row.kind,
    runId: row.run_id,
    taskId: row.task_id,
    payload,
  };
}

/** Recent activity, newest last within the window (chronological for readers). */
export function listActivity(
  store: StateStore,
  opts: { readonly runId?: string; readonly limit?: number } = {},
): ActivityEvent[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows =
    opts.runId === undefined
      ? (store.db
          .prepare(
            `SELECT * FROM (
               SELECT * FROM activity_events ORDER BY id DESC LIMIT ?
             ) ORDER BY id ASC`,
          )
          .all(limit) as unknown as ActivityRow[])
      : (store.db
          .prepare(
            `SELECT * FROM (
               SELECT * FROM activity_events WHERE run_id = ? ORDER BY id DESC LIMIT ?
             ) ORDER BY id ASC`,
          )
          .all(opts.runId, limit) as unknown as ActivityRow[]);
  return rows.map(toActivity);
}
