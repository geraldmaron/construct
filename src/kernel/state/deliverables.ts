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
