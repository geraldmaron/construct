/**
 * kernel/state/runs.ts — workflow runs and their state machine.
 *
 * One run per idempotency key: asking twice returns the same run. States move
 * forward through a validated table; a terminal run never moves again.
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

export const RUN_STATES = [
  'preflight',
  'blocked',
  'ready',
  'running',
  'waiting_for_decision',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type RunState = (typeof RUN_STATES)[number];

export const RUN_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  preflight: ['blocked', 'ready', 'failed', 'cancelled'],
  blocked: ['preflight', 'ready', 'failed', 'cancelled'],
  ready: ['running', 'blocked', 'cancelled'],
  running: ['waiting_for_decision', 'blocked', 'succeeded', 'failed', 'cancelled'],
  waiting_for_decision: ['running', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export const INTERACTION_CLASSES_WITH_RUNS = ['remember', 'manage', 'maintain'] as const;
export type RunInteractionClass = (typeof INTERACTION_CLASSES_WITH_RUNS)[number];

export const TRIGGER_KINDS = ['manual', 'schedule', 'event'] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export const EXECUTOR_KINDS = ['interactive', 'headless'] as const;
export type ExecutorKind = (typeof EXECUTOR_KINDS)[number];

export interface WorkflowRun {
  readonly id: string;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly interactionClass: RunInteractionClass;
  readonly state: RunState;
  readonly triggerKind: TriggerKind;
  readonly idempotencyKey: string;
  readonly executorKind: ExecutorKind;
  readonly executorId: string;
  readonly hostId: string | null;
  readonly sessionId: string | null;
  readonly input: unknown;
  readonly preflight: unknown;
  readonly stateReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly finishedAt: string | null;
}

interface Row {
  readonly id: string;
  readonly workflow_id: string;
  readonly workflow_version: string;
  readonly interaction_class: RunInteractionClass;
  readonly state: RunState;
  readonly trigger_kind: TriggerKind;
  readonly idempotency_key: string;
  readonly executor_kind: ExecutorKind;
  readonly executor_id: string;
  readonly host_id: string | null;
  readonly session_id: string | null;
  readonly input_json: string;
  readonly preflight_json: string | null;
  readonly state_reason: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly finished_at: string | null;
}

function toRun(row: Row): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    interactionClass: row.interaction_class,
    state: row.state,
    triggerKind: row.trigger_kind,
    idempotencyKey: row.idempotency_key,
    executorKind: row.executor_kind,
    executorId: row.executor_id,
    hostId: row.host_id,
    sessionId: row.session_id,
    input: parseJson(row.input_json),
    preflight: parseJson(row.preflight_json),
    stateReason: row.state_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

export interface CreateRunInput {
  readonly id: string;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly interactionClass: RunInteractionClass;
  readonly triggerKind: TriggerKind;
  readonly idempotencyKey: string;
  readonly executorKind: ExecutorKind;
  readonly executorId: string;
  readonly hostId?: string;
  readonly sessionId?: string;
  readonly input: unknown;
  readonly at: string;
}

/**
 * Create a run in `preflight`, or return the existing run for the same
 * idempotency key. `created` tells the caller which happened.
 */
export function createRun(
  store: StateStore,
  input: CreateRunInput,
): { readonly run: WorkflowRun; readonly created: boolean } {
  requireNonEmpty(input.id, 'run.id');
  requireNonEmpty(input.workflowId, 'run.workflowId');
  requireNonEmpty(input.workflowVersion, 'run.workflowVersion');
  requireOneOf(input.interactionClass, INTERACTION_CLASSES_WITH_RUNS, 'run.interactionClass');
  requireOneOf(input.triggerKind, TRIGGER_KINDS, 'run.triggerKind');
  requireNonEmpty(input.idempotencyKey, 'run.idempotencyKey');
  requireOneOf(input.executorKind, EXECUTOR_KINDS, 'run.executorKind');
  requireNonEmpty(input.executorId, 'run.executorId');
  requireInstant(input.at, 'run.at');
  return store.transaction(() => {
    const existing = getRunByKey(store, input.idempotencyKey);
    if (existing) return { run: existing, created: false };
    const row = store.db
      .prepare(
        `INSERT INTO workflow_runs
           (id, workflow_id, workflow_version, interaction_class, state, trigger_kind, idempotency_key,
            executor_kind, executor_id, host_id, session_id, input_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'preflight', ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        input.id,
        input.workflowId,
        input.workflowVersion,
        input.interactionClass,
        input.triggerKind,
        input.idempotencyKey,
        input.executorKind,
        input.executorId,
        input.hostId ?? null,
        input.sessionId ?? null,
        toJson(input.input),
        input.at,
        input.at,
      ) as unknown as Row;
    appendActivity(store, {
      at: input.at,
      kind: 'run.created',
      runId: input.id,
      actor: input.executorId,
      payload: { workflowId: input.workflowId, workflowVersion: input.workflowVersion },
    });
    return { run: toRun(row), created: true };
  });
}

export function getRun(store: StateStore, id: string): WorkflowRun | null {
  const row = store.db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as Row | undefined;
  return row ? toRun(row) : null;
}

export function getRunByKey(store: StateStore, idempotencyKey: string): WorkflowRun | null {
  const row = store.db
    .prepare('SELECT * FROM workflow_runs WHERE idempotency_key = ?')
    .get(idempotencyKey) as Row | undefined;
  return row ? toRun(row) : null;
}

export function listRuns(
  store: StateStore,
  filter: { readonly state?: RunState; readonly workflowId?: string; readonly limit?: number } = {},
): WorkflowRun[] {
  const limit = Math.max(1, Math.min(filter.limit ?? 100, 1000));
  const rows = store.db
    .prepare(
      `SELECT * FROM workflow_runs
        WHERE (? IS NULL OR state = ?) AND (? IS NULL OR workflow_id = ?)
        ORDER BY created_at DESC, id LIMIT ?`,
    )
    .all(
      filter.state ?? null,
      filter.state ?? null,
      filter.workflowId ?? null,
      filter.workflowId ?? null,
      limit,
    ) as unknown as Row[];
  return rows.map(toRun);
}

/** Runs that are not finished: anything but succeeded, failed, cancelled. */
export function listActiveRuns(store: StateStore): WorkflowRun[] {
  const rows = store.db
    .prepare(
      `SELECT * FROM workflow_runs
        WHERE state NOT IN ('succeeded', 'failed', 'cancelled')
        ORDER BY created_at, id`,
    )
    .all() as unknown as Row[];
  return rows.map(toRun);
}

export function transitionRun(
  store: StateStore,
  input: {
    readonly id: string;
    readonly to: RunState;
    readonly at: string;
    readonly reason?: string;
    readonly actor?: string;
    readonly preflight?: unknown;
  },
): WorkflowRun {
  requireOneOf(input.to, RUN_STATES, 'run.state');
  requireInstant(input.at, 'run.at');
  return store.transaction(() => {
    const current = getRun(store, input.id);
    if (!current) throw new Error(`no run ${input.id}`);
    assertTransition(RUN_TRANSITIONS, `run ${input.id}`, current.state, input.to);
    const finished = isTerminal(RUN_TRANSITIONS, input.to) ? input.at : null;
    store.db
      .prepare(
        `UPDATE workflow_runs
            SET state = ?, state_reason = ?, updated_at = ?, finished_at = ?,
                preflight_json = COALESCE(?, preflight_json)
          WHERE id = ?`,
      )
      .run(
        input.to,
        input.reason ?? null,
        input.at,
        finished,
        input.preflight === undefined ? null : toJson(input.preflight),
        input.id,
      );
    appendActivity(store, {
      at: input.at,
      kind: 'run.transition',
      runId: input.id,
      actor: input.actor ?? null,
      payload: { from: current.state, to: input.to, reason: input.reason ?? null },
    });
    return getRun(store, input.id)!;
  });
}
