/**
 * kernel/state/steps.ts — step runs: the DAG's units of work, with leases.
 *
 * A step is claimed under a lease and a fencing token (the attempt number).
 * Settling requires both, so a worker whose lease expired and was taken over
 * cannot overwrite the new holder's work. Every attempt is recorded.
 */

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
  ready: ['leased', 'skipped', 'cancelled'],
  leased: ['succeeded', 'failed', 'ready', 'waiting_for_decision', 'cancelled'],
  waiting_for_decision: ['ready', 'failed', 'cancelled'],
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

export interface LeasedStep extends StepRun {
  readonly leaseOwner: string;
  readonly leaseUntil: string;
  /** Fencing token: the attempt number this lease was granted under. */
  readonly token: number;
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

/**
 * Lease the next claimable step: one that is ready, or leased with an expired
 * lease. Attempts increments on every claim and doubles as the fencing token.
 */
export function claimStep(
  store: StateStore,
  claim: {
    readonly owner: string;
    readonly now: string;
    readonly leaseUntil: string;
    readonly runId?: string;
  },
): LeasedStep | null {
  requireNonEmpty(claim.owner, 'claim.owner');
  requireInstant(claim.now, 'claim.now');
  requireInstant(claim.leaseUntil, 'claim.leaseUntil');
  if (claim.leaseUntil <= claim.now) throw new Error('claim.leaseUntil must be after claim.now');
  return store.transaction(() => {
    const row = store.db
      .prepare(
        `UPDATE step_runs
            SET state = 'leased', lease_owner = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
          WHERE id = (
            SELECT id FROM step_runs
             WHERE (state = 'ready' OR (state = 'leased' AND lease_until <= ?))
               AND attempts < max_attempts
               AND (? IS NULL OR run_id = ?)
             ORDER BY ordinal, created_at, id
             LIMIT 1
          )
        RETURNING *`,
      )
      .get(claim.owner, claim.leaseUntil, claim.now, claim.now, claim.runId ?? null, claim.runId ?? null) as
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
    return { ...step, leaseOwner: claim.owner, leaseUntil: claim.leaseUntil, token: step.attempts };
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
    const retry = current.attempts < current.maxAttempts;
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
