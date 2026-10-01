/**
 * kernel/state/steps.ts — step runs: the DAG's units of work, with leases.
 *
 * A step is claimed under a lease and a fencing token (the attempt number).
 * Settling requires both, so a worker whose lease expired and was taken over
 * cannot overwrite the new holder's work. Every attempt is recorded.
 */

import { randomUUID } from 'node:crypto';
import type { StateStore } from './open.ts';
import { appendActivity } from './activity.ts';
import {
  assertTransition,
  isTerminal,
  parseJson,
  requireInstant,
  requireNonEmpty,
  requireOneOf,
  toJson,
} from './rows.ts';

export const ACTION_TIERS = [
  'observe',
  'draft',
  'project_write',
  'external_write',
  'destructive',
  'licensed_judgment',
] as const;
export type ActionTier = (typeof ACTION_TIERS)[number];

export const STEP_STATES = [
  'pending',
  'ready',
  'leased',
  'waiting_for_decision',
  'succeeded',
  'failed',
  'skipped',
  'cancelled',
] as const;
export type StepState = (typeof STEP_STATES)[number];

export const STEP_TRANSITIONS: Readonly<Record<StepState, readonly StepState[]>> = {
  pending: ['ready', 'skipped', 'cancelled'],
  ready: ['leased', 'waiting_for_decision', 'skipped', 'cancelled'],
  leased: ['succeeded', 'failed', 'ready', 'waiting_for_decision', 'cancelled'],
  waiting_for_decision: ['ready', 'failed', 'cancelled', 'skipped'],
  succeeded: [],
  failed: [],
  skipped: [],
  cancelled: [],
};

export interface StepRun {
  readonly id: string;
  readonly runId: string;
  readonly stepId: string;
  readonly ordinal: number;
  readonly permissionTier: ActionTier;
  readonly state: StepState;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly leaseOwner: string | null;
  readonly leaseUntil: string | null;
  readonly input: unknown;
  readonly output: unknown;
  readonly stateReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly finishedAt: string | null;
}

/**
 * How many attempts may end with their lease running out before the step
 * fails. A holder that crashes or walks away does not spend the retry budget
 * the step's own failures do, but a step whose every holder crashes still ends.
 */
export const EXPIRED_ATTEMPTS_ALLOWED = 3;

const FAILED = `(SELECT COUNT(*) FROM step_attempts a WHERE a.step_run_id = step_runs.id AND a.outcome = 'failed')`;
const EXPIRED = `(SELECT COUNT(*) FROM step_attempts a WHERE a.step_run_id = step_runs.id AND a.outcome = 'expired')`;

function failedAttempts(store: StateStore, stepRunId: string): number {
  return (store.db.prepare(`SELECT COUNT(*) AS n FROM step_attempts WHERE step_run_id = ? AND outcome = 'failed'`).get(stepRunId) as { n: number }).n;
}

function expiredAttempts(store: StateStore, stepRunId: string): number {
  return (store.db.prepare(`SELECT COUNT(*) AS n FROM step_attempts WHERE step_run_id = ? AND outcome = 'expired'`).get(stepRunId) as { n: number }).n;
}

export interface LeasedStep extends StepRun {
  readonly leaseOwner: string;
  readonly leaseUntil: string;
  /** Fencing token: the attempt number this lease was granted under. */
  readonly token: number;
  /**
   * The lease's secret: a random value only the claimer is given. A caller
   * outside the kernel proves it holds the lease with this, never with the
   * attempt number, which anyone can read.
   */
  readonly nonce: string;
}

export class StaleLeaseError extends Error {
  constructor(stepRunId: string, token: number) {
    super(
      `step ${stepRunId} is no longer held under token ${String(token)}: its lease expired and another worker took it over`,
    );
    this.name = 'StaleLeaseError';
  }
}

interface Row {
  readonly id: string;
  readonly run_id: string;
  readonly step_id: string;
  readonly ordinal: number;
  readonly permission_tier: ActionTier;
  readonly state: StepState;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly lease_owner: string | null;
  readonly lease_until: string | null;
  readonly lease_nonce?: string | null;
  readonly input_json: string | null;
  readonly output_json: string | null;
  readonly state_reason: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly finished_at: string | null;
}

function toStep(row: Row): StepRun {
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    ordinal: row.ordinal,
    permissionTier: row.permission_tier,
    state: row.state,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    leaseOwner: row.lease_owner,
    leaseUntil: row.lease_until,
    input: parseJson(row.input_json),
    output: parseJson(row.output_json),
    stateReason: row.state_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

export function addStep(
  store: StateStore,
  input: {
    readonly id: string;
    readonly runId: string;
    readonly stepId: string;
    readonly ordinal: number;
    readonly permissionTier: ActionTier;
    readonly maxAttempts?: number;
    readonly input?: unknown;
    readonly ready?: boolean;
    readonly at: string;
  },
): StepRun {
  requireNonEmpty(input.id, 'step.id');
  requireNonEmpty(input.stepId, 'step.stepId');
  requireOneOf(input.permissionTier, ACTION_TIERS, 'step.permissionTier');
  requireInstant(input.at, 'step.at');
  if (!Number.isInteger(input.ordinal) || input.ordinal < 0) {
    throw new Error('step.ordinal must be a non-negative integer');
  }
  const maxAttempts = input.maxAttempts ?? 1;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('step.maxAttempts must be a positive integer');
  }
  const row = store.db
    .prepare(
      `INSERT INTO step_runs
         (id, run_id, step_id, ordinal, permission_tier, state, attempts, max_attempts, input_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?) RETURNING *`,
    )
    .get(
      input.id,
      input.runId,
      input.stepId,
      input.ordinal,
      input.permissionTier,
      input.ready ? 'ready' : 'pending',
      maxAttempts,
      input.input === undefined ? null : toJson(input.input),
      input.at,
      input.at,
    ) as unknown as Row;
  return toStep(row);
}

export function getStep(store: StateStore, id: string): StepRun | null {
  const row = store.db.prepare('SELECT * FROM step_runs WHERE id = ?').get(id) as Row | undefined;
  return row ? toStep(row) : null;
}

export function listSteps(store: StateStore, runId: string): StepRun[] {
  const rows = store.db
    .prepare('SELECT * FROM step_runs WHERE run_id = ? ORDER BY ordinal, id')
    .all(runId) as unknown as Row[];
  return rows.map(toStep);
}

/** Move a step between non-lease states (pending→ready, skip, cancel, resume). */
export function transitionStep(
  store: StateStore,
  input: {
    readonly id: string;
    readonly to: Exclude<StepState, 'leased' | 'succeeded' | 'failed'>;
    readonly at: string;
    readonly reason?: string;
  },
): StepRun {
  requireInstant(input.at, 'step.at');
  return store.transaction(() => {
    const current = getStep(store, input.id);
    if (!current) throw new Error(`no step ${input.id}`);
    assertTransition(STEP_TRANSITIONS, `step ${input.id}`, current.state, input.to);
    const finished = isTerminal(STEP_TRANSITIONS, input.to) ? input.at : null;
    store.db
      .prepare(
        `UPDATE step_runs
            SET state = ?, state_reason = ?, updated_at = ?, finished_at = ?,
                lease_owner = NULL, lease_until = NULL
          WHERE id = ?`,
      )
      .run(input.to, input.reason ?? null, input.at, finished, input.id);
    if (current.state === 'leased') {
      closeAttempt(store, input.id, current.attempts, input.at, input.to === 'waiting_for_decision' ? 'paused' : 'cancelled', null);
    }
    appendActivity(store, {
      at: input.at,
      kind: 'step.transition',
      runId: current.runId,
      stepRunId: input.id,
      payload: { stepId: current.stepId, from: current.state, to: input.to, reason: input.reason ?? null },
    });
    return getStep(store, input.id)!;
  });
}

/** Give a step one more attempt than its policy allowed, because a person asked for it. */
export function grantExtraAttempt(store: StateStore, input: { readonly id: string; readonly at: string; readonly by: string }): StepRun {
  return store.transaction(() => {
    const current = getStep(store, input.id);
    if (!current) throw new Error(`no step ${input.id}`);
    store.db.prepare('UPDATE step_runs SET max_attempts = MAX(max_attempts, attempts + 1), updated_at = ? WHERE id = ?').run(input.at, input.id);
    appendActivity(store, { at: input.at, kind: 'step.attempt_granted', runId: current.runId, stepRunId: input.id, actor: input.by, payload: { stepId: current.stepId, attempts: current.attempts } });
    return getStep(store, input.id)!;
  });
}

/**
 * Lease the next claimable step: one that is ready, or leased with an expired
 * lease. Attempts increments on every claim and doubles as the fencing token.
 * With `stepRunId`, only that step is leased, so a caller that gated one step
 * leases exactly the step it gated.
 */
export function claimStep(
  store: StateStore,
  claim: {
    readonly owner: string;
    readonly now: string;
    readonly leaseUntil: string;
    readonly runId?: string;
    readonly stepRunId?: string;
  },
): LeasedStep | null {
  requireNonEmpty(claim.owner, 'claim.owner');
  requireInstant(claim.now, 'claim.now');
  requireInstant(claim.leaseUntil, 'claim.leaseUntil');
  if (claim.leaseUntil <= claim.now) throw new Error('claim.leaseUntil must be after claim.now');
  const nonce = randomUUID();
  return store.transaction(() => {
    const row = store.db
      .prepare(
        `UPDATE step_runs
            SET state = 'leased', lease_owner = ?, lease_until = ?, lease_nonce = ?, attempts = attempts + 1, updated_at = ?
          WHERE id = (
            SELECT id FROM step_runs
             WHERE ((state = 'ready' AND ${FAILED} < max_attempts AND ${EXPIRED} < ${EXPIRED_ATTEMPTS_ALLOWED})
                 OR (state = 'leased' AND lease_until <= ? AND ${FAILED} < max_attempts AND ${EXPIRED} + 1 < ${EXPIRED_ATTEMPTS_ALLOWED}))
               AND (? IS NULL OR run_id = ?)
               AND (? IS NULL OR id = ?)
             ORDER BY ordinal, created_at, id
             LIMIT 1
          )
        RETURNING *`,
      )
      .get(claim.owner, claim.leaseUntil, nonce, claim.now, claim.now, claim.runId ?? null, claim.runId ?? null, claim.stepRunId ?? null, claim.stepRunId ?? null) as
      | Row
      | undefined;
    if (!row) return null;
    const step = toStep(row);
    if (step.attempts > 1) {
      // The prior holder's attempt ended by expiry, not by its own report.
      closeAttempt(store, step.id, step.attempts - 1, claim.now, 'expired', null);
    }
    store.db
      .prepare(
        `INSERT INTO step_attempts (step_run_id, attempt, owner, started_at) VALUES (?, ?, ?, ?)`,
      )
      .run(step.id, step.attempts, claim.owner, claim.now);
    appendActivity(store, {
      at: claim.now,
      kind: 'step.leased',
      runId: step.runId,
      stepRunId: step.id,
      actor: claim.owner,
      payload: { stepId: step.stepId, attempt: step.attempts, leaseUntil: claim.leaseUntil },
    });
    return { ...step, leaseOwner: claim.owner, leaseUntil: claim.leaseUntil, token: step.attempts, nonce };
  });
}

/**
 * Reclaim expired leases: return the step to `ready` so a later claim can
 * start a new attempt, or fail it when its budget is spent. A lease that ran
 * out is not the step's own failure, so it spends the expiry allowance, not
 * the step's retry budget. The reaping runs inside whichever call came next,
 * so its rows record the kernel as actor and no session; the holder that
 * walked away is named in the payload.
 */
export function expireDeadLeases(store: StateStore, now: string, runId?: string): number {
  requireInstant(now, 'expire.now');
  return store.transaction(() => {
    const spent = store.db
      .prepare(
        `SELECT * FROM step_runs
          WHERE state = 'leased' AND lease_until <= ? AND (${FAILED} >= max_attempts OR ${EXPIRED} + 1 >= ${EXPIRED_ATTEMPTS_ALLOWED})
            AND (? IS NULL OR run_id = ?)`,
      )
      .all(now, runId ?? null, runId ?? null) as unknown as Row[];
    for (const row of spent) {
      const step = toStep(row);
      closeAttempt(store, step.id, step.attempts, now, 'expired', { reason: 'lease expired and the step’s budget is spent' });
      store.db
        .prepare(
          `UPDATE step_runs SET state = 'failed', lease_owner = NULL, lease_until = NULL, state_reason = ?, updated_at = ?, finished_at = ?
            WHERE id = ?`,
        )
        .run('lease expired and the step’s budget is spent', now, now, step.id);
      appendActivity(store, {
        at: now,
        kind: 'step.failed',
        runId: step.runId,
        stepRunId: step.id,
        actor: 'kernel',
        unattributed: true,
        payload: { stepId: step.stepId, attempt: step.attempts, reason: 'lease expired and the step’s budget is spent', previousHolder: step.leaseOwner },
      });
    }
    const remaining = store.db
      .prepare(
        `SELECT * FROM step_runs
          WHERE state = 'leased' AND lease_until <= ? AND ${FAILED} < max_attempts AND ${EXPIRED} + 1 < ${EXPIRED_ATTEMPTS_ALLOWED}
            AND (? IS NULL OR run_id = ?)`,
      )
      .all(now, runId ?? null, runId ?? null) as unknown as Row[];
    for (const row of remaining) {
      const step = toStep(row);
      closeAttempt(store, step.id, step.attempts, now, 'expired', { reason: 'lease expired' });
      store.db
        .prepare(
          `UPDATE step_runs SET state = 'ready', lease_owner = NULL, lease_until = NULL, state_reason = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run('lease expired', now, step.id);
      appendActivity(store, {
        at: now,
        kind: 'step.retry_scheduled',
        runId: step.runId,
        stepRunId: step.id,
        actor: 'kernel',
        unattributed: true,
        payload: { stepId: step.stepId, attempt: step.attempts, reason: 'lease expired', previousHolder: step.leaseOwner },
      });
    }
    return spent.length + remaining.length;
  });
}

function closeAttempt(
  store: StateStore,
  stepRunId: string,
  attempt: number,
  at: string,
  outcome: 'succeeded' | 'failed' | 'expired' | 'cancelled' | 'paused',
  error: unknown,
): void {
  store.db
    .prepare(
      `UPDATE step_attempts SET ended_at = ?, outcome = ?, error_json = ?
        WHERE step_run_id = ? AND attempt = ? AND ended_at IS NULL`,
    )
    .run(at, outcome, error === null ? null : toJson(error), stepRunId, attempt);
}

function settle(
  store: StateStore,
  input: { readonly id: string; readonly owner: string; readonly token: number; readonly at: string },
  to: 'succeeded' | 'failed' | 'ready',
  payload: { readonly output?: unknown; readonly error?: unknown; readonly reason?: string },
): StepRun {
  requireInstant(input.at, 'step.at');
  return store.transaction(() => {
    const finished = to === 'ready' ? null : input.at;
    const result = store.db
      .prepare(
        `UPDATE step_runs
            SET state = ?, output_json = COALESCE(?, output_json), state_reason = ?,
                updated_at = ?, finished_at = ?, lease_owner = NULL, lease_until = NULL
          WHERE id = ? AND state = 'leased' AND lease_owner = ? AND attempts = ?`,
      )
      .run(
        to,
        payload.output === undefined ? null : toJson(payload.output),
        payload.reason ?? null,
        input.at,
        finished,
        input.id,
        input.owner,
        input.token,
      );
    if (result.changes === 0) throw new StaleLeaseError(input.id, input.token);
    closeAttempt(store, input.id, input.token, input.at, to === 'succeeded' ? 'succeeded' : 'failed', payload.error ?? null);
    const step = getStep(store, input.id)!;
    appendActivity(store, {
      at: input.at,
      kind: to === 'succeeded' ? 'step.succeeded' : to === 'failed' ? 'step.failed' : 'step.retry_scheduled',
      runId: step.runId,
      stepRunId: step.id,
      actor: input.owner,
      payload: { stepId: step.stepId, attempt: input.token, reason: payload.reason ?? null },
    });
    return step;
  });
}

export function completeStep(
  store: StateStore,
  done: {
    readonly id: string;
    readonly owner: string;
    readonly token: number;
    readonly at: string;
    readonly output: unknown;
  },
): StepRun {
  return settle(store, done, 'succeeded', { output: done.output });
}

/**
 * Fail an attempt. If attempts remain the step returns to ready for another
 * try; otherwise it fails for good. The caller never chooses which.
 */
export function failStep(
  store: StateStore,
  failed: {
    readonly id: string;
    readonly owner: string;
    readonly token: number;
    readonly at: string;
    readonly error: unknown;
    readonly reason: string;
  },
): StepRun {
  return store.transaction(() => {
    const current = getStep(store, failed.id);
    if (!current) throw new Error(`no step ${failed.id}`);
    const retry = failedAttempts(store, failed.id) + 1 < current.maxAttempts && expiredAttempts(store, failed.id) < EXPIRED_ATTEMPTS_ALLOWED;
    return settle(store, failed, retry ? 'ready' : 'failed', {
      error: failed.error,
      reason: failed.reason,
    });
  });
}

export interface StepAttempt {
  readonly attempt: number;
  readonly owner: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly outcome: 'succeeded' | 'failed' | 'expired' | 'cancelled' | 'paused' | null;
  readonly error: unknown;
}

export function listAttempts(store: StateStore, stepRunId: string): StepAttempt[] {
  const rows = store.db
    .prepare('SELECT * FROM step_attempts WHERE step_run_id = ? ORDER BY attempt')
    .all(stepRunId) as unknown as Array<{
    attempt: number;
    owner: string;
    started_at: string;
    ended_at: string | null;
    outcome: StepAttempt['outcome'];
    error_json: string | null;
  }>;
  return rows.map((r) => ({
    attempt: r.attempt,
    owner: r.owner,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    outcome: r.outcome,
    error: parseJson(r.error_json),
  }));
}

export function countStepsByState(store: StateStore, runId: string): Record<StepState, number> {
  const counts = Object.fromEntries(STEP_STATES.map((s) => [s, 0])) as Record<StepState, number>;
  for (const step of listSteps(store, runId)) counts[step.state] += 1;
  return counts;
}

/** The lease a caller proves it holds with the step's secret, or null when it does not hold it. */
export function heldLease(store: StateStore, input: { readonly id: string; readonly owner: string; readonly nonce: string }): LeasedStep | null {
  const row = store.db
    .prepare(`SELECT * FROM step_runs WHERE id = ? AND state = 'leased' AND lease_owner = ? AND lease_nonce = ?`)
    .get(input.id, input.owner, input.nonce) as Row | undefined;
  if (!row) return null;
  const step = toStep(row);
  return { ...step, leaseOwner: row.lease_owner!, leaseUntil: row.lease_until!, token: step.attempts, nonce: input.nonce };
}

/** Extend a held lease, proving it with the lease's secret. False when it is no longer held. */
export function extendLease(store: StateStore, input: { readonly id: string; readonly owner: string; readonly nonce: string; readonly until: string; readonly at: string }): boolean {
  const result = store.db
    .prepare(`UPDATE step_runs SET lease_until = ?, updated_at = ? WHERE id = ? AND state = 'leased' AND lease_owner = ? AND lease_nonce = ? AND lease_until > ?`)
    .run(input.until, input.at, input.id, input.owner, input.nonce, input.at);
  return Number(result.changes) > 0;
}

/**
 * Extend every live lease `owner` holds that is past half its term, so an
 * executor that keeps calling Construct does not lose a long step to expiry.
 */
export function renewExecutorLeases(store: StateStore, input: { readonly owner: string; readonly now: string; readonly termMs: number }): number {
  const until = new Date(Date.parse(input.now) + input.termMs).toISOString();
  const halfway = new Date(Date.parse(input.now) + input.termMs / 2).toISOString();
  return Number(
    store.db
      .prepare(`UPDATE step_runs SET lease_until = ?, updated_at = ? WHERE state = 'leased' AND lease_owner = ? AND lease_until > ? AND lease_until < ?`)
      .run(until, input.now, input.owner, input.now, halfway).changes,
  );
}
