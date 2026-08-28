/**
 * kernel/store/tasks.ts — one row per unit of work the coordinator dispatches,
 * with the two properties that make a crashed run recoverable rather than
 * wedged: a lease, and a fencing token.
 *
 * A lease is a claim with an expiry. A worker takes a task by writing its own
 * id and a deadline; if the process dies, the deadline passes and the next
 * worker may take the task over. Nothing needs to detect the crash and nothing
 * needs to be unstuck by hand — the absence of a heartbeat IS the signal.
 *
 * The fencing token is `attempts`, and it is what stops takeover from becoming
 * duplication. A worker that stalls past its own deadline is indistinguishable
 * from a dead one, so it may wake up after another worker has already taken the
 * task and finished it. Every claim increments `attempts` and returns the new
 * value; settling a task requires presenting that exact value, so the stale
 * worker's write is rejected instead of overwriting a newer result. Comparing
 * lease deadlines instead would put clock skew between two processes in charge
 * of correctness; a counter has no clock in it.
 *
 * `enqueueTask` is INSERT OR IGNORE on a caller-chosen id. Recording the same
 * run twice therefore enqueues nothing the second time — the id is the
 * idempotency key, and choosing it deterministically is the caller's job.
 *
 * There is deliberately no retry policy here. Commitment 1 says Construct rides
 * the host and never rebuilds it, and the host owns retries; a failed task is
 * terminal, recorded, and visible. Recovering a crashed run and retrying a
 * failed one are different things, and only the first is this module's business.
 *
 * Same disciplines as the rest of the store: no clock, no environment. Every
 * timestamp arrives as an argument.
 */

import type { Store } from './open.ts';

export const TASK_STATES = ['pending', 'leased', 'done', 'failed'] as const;

export type TaskState = (typeof TASK_STATES)[number];

export interface Task {
  readonly id: string;
  readonly run: string;
  readonly role: string;
  /** The brief this task executes, as declared at enqueue time. */
  readonly brief: unknown;
  readonly state: TaskState;
  /** Claim count. Doubles as the lease's fencing token. */
  readonly attempts: number;
  readonly leaseOwner: string | null;
  readonly leaseUntil: string | null;
  readonly result: unknown;
  readonly error: unknown;
  /** Host-reported cost of this task, in the host's own units. */
  readonly spend: number;
  /**
   * Whether the host actually reported a cost. A local model reports 0, and so
   * does an adapter that does not report cost at all — separating the two is
   * what keeps "we stayed under the ceiling" from being a claim nobody measured.
   */
  readonly spendReported: boolean;
  readonly enqueuedAt: string;
  readonly settledAt: string | null;
}

/** A task this process currently holds, carrying the token needed to settle it. */
export interface LeasedTask extends Task {
  readonly leaseOwner: string;
  readonly leaseUntil: string;
  /** Present this back to completeTask/failTask. Equal to `attempts`. */
  readonly token: number;
}

export interface EnqueueTask {
  readonly id: string;
  readonly run: string;
  readonly role: string;
  readonly brief: unknown;
  /** Injected; the kernel never reads the clock. */
  readonly at: string;
}

export interface ClaimTask {
  readonly owner: string;
  /** When this claim expires, so another worker may take the task over. */
  readonly leaseUntil: string;
  /** Now, for judging which existing leases have expired. */
  readonly now: string;
  /** Restrict the claim to one run. Omit to claim across all of them. */
  readonly run?: string;
}

export interface SettleTask {
  readonly id: string;
  readonly owner: string;
  readonly token: number;
  readonly at: string;
}

export interface CompleteTask extends SettleTask {
  readonly result: unknown;
  readonly spend: number;
  readonly spendReported: boolean;
}

export interface FailTask extends SettleTask {
  readonly error: unknown;
  /**
   * Real cost the host reported before this task was judged a failure. A
   * dispatch that spends real tokens and then returns nothing checkable did
   * not spend nothing — recording 0 here would make that spend invisible to
   * the run's cost ceiling. Optional and defaults to 0/false: most failures
   * (an auth error, a timeout) settle before any model call completes.
   */
  readonly spend?: number;
  readonly spendReported?: boolean;
}

/**
 * Raised when a settle is presented with a token that is no longer the task's.
 * Distinct from a generic Error because it is an expected outcome of the lease
 * model, not a defect: a worker that stalled past its deadline learns here that
 * its work was taken over, and the coordinator drops the duplicate result.
 */
export class StaleLeaseError extends Error {
  readonly taskId: string;
  readonly token: number;

  constructor(taskId: string, token: number) {
    super(
      `task ${taskId} is no longer held under token ${String(token)} — its lease expired and another worker took it over`,
    );
    this.name = 'StaleLeaseError';
    this.taskId = taskId;
    this.token = token;
  }
}

interface Row {
  readonly id: string;
  readonly run: string;
  readonly role: string;
  readonly brief: string;
  readonly state: string;
  readonly attempts: number;
  readonly lease_owner: string | null;
  readonly lease_until: string | null;
  readonly result: string | null;
  readonly error: string | null;
  readonly spend: number;
  readonly spend_reported: number;
  readonly enqueued_at: string;
  readonly settled_at: string | null;
}

function toTask(row: Row): Task {
  return {
    id: row.id,
    run: row.run,
    role: row.role,
    brief: JSON.parse(row.brief),
    state: row.state as TaskState,
    attempts: row.attempts,
    leaseOwner: row.lease_owner,
    leaseUntil: row.lease_until,
    result: row.result === null ? null : JSON.parse(row.result),
    error: row.error === null ? null : JSON.parse(row.error),
    spend: row.spend,
    spendReported: row.spend_reported === 1,
    enqueuedAt: row.enqueued_at,
    settledAt: row.settled_at,
  };
}

/**
 * Enqueue a task. Returns false when the id already exists — the caller asked
 * for something already recorded, which on a resumed run is the normal case and
 * not an error.
 */
export function enqueueTask(store: Store, task: EnqueueTask): boolean {
  const result = store.db
    .prepare(
      `INSERT OR IGNORE INTO tasks (id, run, role, brief, state, enqueued_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    )
    .run(task.id, task.run, task.role, JSON.stringify(task.brief ?? null), task.at);
  return result.changes > 0;
}

/**
 * Take the oldest claimable task, or null when there is none.
 *
 * Claimable means pending, or leased with an expired deadline — the second is
 * how a crashed run's work returns to circulation. Done and failed tasks are
 * never claimable, which is what makes a resumed run skip finished work instead
 * of repeating it.
 *
 * One statement, so the read and the write cannot interleave with another
 * worker's claim between them.
 */
export function claimTask(store: Store, claim: ClaimTask): LeasedTask | null {
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
             AND (? IS NULL OR run = ?)
           ORDER BY enqueued_at, id
           LIMIT 1
        )
    RETURNING *`,
    )
    .get(claim.owner, claim.leaseUntil, claim.now, claim.run ?? null, claim.run ?? null) as
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
  store: Store,
  sql: string,
  params: readonly (string | number | null)[],
  id: string,
  token: number,
): void {
  const result = store.db.prepare(sql).run(...params);
  if (result.changes === 0) throw new StaleLeaseError(id, token);
}

/**
 * Record a finished task. Throws StaleLeaseError if this worker no longer holds
 * the lease — the result is then dropped rather than overwriting the one written
 * by whoever took the task over.
 */
export function completeTask(store: Store, done: CompleteTask): void {
  settle(
    store,
    `UPDATE tasks
        SET state = 'done', result = ?, spend = ?, spend_reported = ?,
            settled_at = ?, lease_owner = NULL, lease_until = NULL
      WHERE id = ? AND state = 'leased' AND lease_owner = ? AND attempts = ?`,
    [
      JSON.stringify(done.result ?? null),
      done.spend,
      done.spendReported ? 1 : 0,
      done.at,
      done.id,
      done.owner,
      done.token,
    ],
    done.id,
    done.token,
  );
}

/**
 * Record a failed task. Terminal by design — see the module note on why retry
 * policy stays on the host's side of the seam.
 */
export function failTask(store: Store, failed: FailTask): void {
  settle(
    store,
    `UPDATE tasks
        SET state = 'failed', error = ?, spend = ?, spend_reported = ?, settled_at = ?,
            lease_owner = NULL, lease_until = NULL
      WHERE id = ? AND state = 'leased' AND lease_owner = ? AND attempts = ?`,
    [
      JSON.stringify(failed.error ?? null),
      failed.spend ?? 0,
      failed.spendReported ? 1 : 0,
      failed.at,
      failed.id,
      failed.owner,
      failed.token,
    ],
    failed.id,
    failed.token,
  );
}

export function getTask(store: Store, id: string): Task | null {
  const row = store.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
  return row ? toTask(row) : null;
}

/** A run's tasks in enqueue order. Omit `run` to read all of them. */
export function listTasks(store: Store, run?: string): Task[] {
  const rows = (
    run
      ? store.db.prepare('SELECT * FROM tasks WHERE run = ? ORDER BY enqueued_at, id').all(run)
      : store.db.prepare('SELECT * FROM tasks ORDER BY enqueued_at, id').all()
  ) as unknown as Row[];
  return rows.map(toTask);
}

/** How many tasks sit in each state. States with no rows are absent. */
export function countTasksByState(store: Store, run?: string): Record<string, number> {
  const rows = (
    run
      ? store.db
          .prepare('SELECT state, COUNT(*) AS n FROM tasks WHERE run = ? GROUP BY state')
          .all(run)
      : store.db.prepare('SELECT state, COUNT(*) AS n FROM tasks GROUP BY state').all()
  ) as unknown as { state: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.state, r.n]));
}

/**
 * Everything spent so far, across every run in this store. The ceiling is
 * global on purpose: ten runs of nine dollars each is exactly the shape a
 * per-run cap fails to catch.
 */
export function totalSpend(store: Store, run?: string): number {
  const row = (
    run
      ? store.db.prepare('SELECT COALESCE(SUM(spend), 0) AS total FROM tasks WHERE run = ?').get(run)
      : store.db.prepare('SELECT COALESCE(SUM(spend), 0) AS total FROM tasks').get()
  ) as { total: number };
  return row.total;
}
