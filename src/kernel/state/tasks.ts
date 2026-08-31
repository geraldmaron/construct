/**
 * kernel/state/tasks.ts — task execution state machine for format v1.
 *
 * pending → leased → done | failed
 *
 * Lease ownership, fencing via attempts, expiry, and stale-worker rejection
 * live here. Deliverable trust does not.
 */

import type { StateStore } from './open.ts';

export const TASK_STATES = ['pending', 'leased', 'done', 'failed'] as const;
export type TaskState = (typeof TASK_STATES)[number];

export interface Task {
  readonly id: string;
  readonly runId: string;
  readonly role: string;
  readonly brief: unknown;
  readonly state: TaskState;
  readonly attempts: number;
  readonly leaseOwner: string | null;
  readonly leaseUntil: string | null;
  readonly result: unknown;
  readonly error: unknown;
  readonly enqueuedAt: string;
  readonly settledAt: string | null;
}

export interface LeasedTask extends Task {
  readonly leaseOwner: string;
  readonly leaseUntil: string;
  readonly token: number;
}

export class StaleLeaseError extends Error {
  constructor(taskId: string, token: number) {
    super(
      `task ${taskId} is no longer held under token ${String(token)} — its lease expired and another worker took it over`,
    );
    this.name = 'StaleLeaseError';
  }
}

interface Row {
  readonly id: string;
  readonly run_id: string;
  readonly role: string;
  readonly brief_json: string;
  readonly state: TaskState;
  readonly attempts: number;
  readonly lease_owner: string | null;
  readonly lease_until: string | null;
  readonly result_json: string | null;
  readonly error_json: string | null;
  readonly enqueued_at: string;
  readonly settled_at: string | null;
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function toTask(row: Row): Task {
  return {
    id: row.id,
    runId: row.run_id,
    role: row.role,
    brief: parseJson(row.brief_json),
    state: row.state,
    attempts: row.attempts,
    leaseOwner: row.lease_owner,
    leaseUntil: row.lease_until,
    result: parseJson(row.result_json),
    error: parseJson(row.error_json),
    enqueuedAt: row.enqueued_at,
    settledAt: row.settled_at,
  };
}

export function ensureRun(
  store: StateStore,
  input: { readonly id: string; readonly outcome: string; readonly at: string },
): void {
  store.db
    .prepare(
      `INSERT OR IGNORE INTO runs (id, outcome, status, created_at) VALUES (?, ?, 'open', ?)`,
    )
    .run(input.id, input.outcome, input.at);
}

export function enqueueTask(
  store: StateStore,
  input: {
    readonly id: string;
    readonly runId: string;
    readonly role: string;
    readonly brief: unknown;
    readonly at: string;
  },
): void {
  store.db
    .prepare(
      `INSERT OR IGNORE INTO tasks
        (id, run_id, role, brief_json, state, attempts, enqueued_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?)`,
    )
    .run(input.id, input.runId, input.role, JSON.stringify(input.brief ?? null), input.at);
}

export function claimTask(
  store: StateStore,
  claim: {
    readonly owner: string;
    readonly leaseUntil: string;
    readonly now: string;
    readonly runId?: string;
  },
): LeasedTask | null {
  const row = store.db
    .prepare(
      `UPDATE tasks
          SET state = 'leased',
              lease_owner = ?,
              lease_until = ?,
              attempts = attempts + 1
        WHERE id = (
          SELECT id FROM tasks
           WHERE (state = 'pending' OR (state = 'leased' AND lease_until <= ?))
             AND (? IS NULL OR run_id = ?)
           ORDER BY enqueued_at, id
           LIMIT 1
        )
      RETURNING *`,
    )
    .get(claim.owner, claim.leaseUntil, claim.now, claim.runId ?? null, claim.runId ?? null) as
    | Row
    | undefined;

  if (!row) return null;
  const task = toTask(row);
  return {
    ...task,
    leaseOwner: claim.owner,
    leaseUntil: claim.leaseUntil,
    token: task.attempts,
  };
}

function settle(
  store: StateStore,
  sql: string,
  params: readonly (string | number | null)[],
  id: string,
  token: number,
): void {
  const result = store.db.prepare(sql).run(...params);
  if (result.changes === 0) throw new StaleLeaseError(id, token);
}

export function completeTask(
  store: StateStore,
  done: {
    readonly id: string;
    readonly owner: string;
    readonly token: number;
    readonly at: string;
    readonly result: unknown;
  },
): void {
  settle(
    store,
    `UPDATE tasks
        SET state = 'done', result_json = ?, settled_at = ?,
            lease_owner = NULL, lease_until = NULL
      WHERE id = ? AND state = 'leased' AND lease_owner = ? AND attempts = ?`,
    [JSON.stringify(done.result ?? null), done.at, done.id, done.owner, done.token],
    done.id,
    done.token,
  );
}

export function failTask(
  store: StateStore,
  failed: {
    readonly id: string;
    readonly owner: string;
    readonly token: number;
    readonly at: string;
    readonly error: unknown;
  },
): void {
  settle(
    store,
    `UPDATE tasks
        SET state = 'failed', error_json = ?, settled_at = ?,
            lease_owner = NULL, lease_until = NULL
      WHERE id = ? AND state = 'leased' AND lease_owner = ? AND attempts = ?`,
    [JSON.stringify(failed.error ?? null), failed.at, failed.id, failed.owner, failed.token],
    failed.id,
    failed.token,
  );
}

export function getTask(store: StateStore, id: string): Task | null {
  const row = store.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
  return row ? toTask(row) : null;
}
