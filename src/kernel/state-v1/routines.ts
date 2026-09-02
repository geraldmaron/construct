/**
 * kernel/state-v1/routines.ts — unified recurring / event / scheduled work.
 *
 * Replaces standing + watch + schedule + daemon as product concepts.
 */

import type { StateStore } from './open.ts';
import { appendActivity } from './deliverables.ts';

export type RoutineTriggerKind = 'manual' | 'scheduled' | 'event';

export interface Routine {
  readonly id: string;
  readonly ownerStaffId: string | null;
  readonly enabled: boolean;
  readonly triggerKind: RoutineTriggerKind;
  readonly trigger: unknown;
  readonly workflow: unknown;
  readonly inputSourceIds: readonly string[];
  readonly expectedOutput: string;
  readonly executionPolicy: unknown;
  readonly approvalBoundary: unknown;
  readonly noDataPolicy: string;
  readonly staleDataPolicy: string;
  readonly retryPolicy: unknown;
  readonly lastRunAt: string | null;
  readonly nextRunAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface Row {
  readonly id: string;
  readonly owner_staff_id: string | null;
  readonly enabled: number;
  readonly trigger_kind: RoutineTriggerKind;
  readonly trigger_json: string;
  readonly workflow_json: string;
  readonly input_source_ids_json: string;
  readonly expected_output: string;
  readonly execution_policy_json: string;
  readonly approval_boundary_json: string;
  readonly no_data_policy: string;
  readonly stale_data_policy: string;
  readonly retry_policy_json: string;
  readonly last_run_at: string | null;
  readonly next_run_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

function toRoutine(row: Row): Routine {
  const sources = JSON.parse(row.input_source_ids_json) as unknown;
  return {
    id: row.id,
    ownerStaffId: row.owner_staff_id,
    enabled: row.enabled === 1,
    triggerKind: row.trigger_kind,
    trigger: JSON.parse(row.trigger_json),
    workflow: JSON.parse(row.workflow_json),
    inputSourceIds: Array.isArray(sources) ? sources.map(String) : [],
    expectedOutput: row.expected_output,
    executionPolicy: JSON.parse(row.execution_policy_json),
    approvalBoundary: JSON.parse(row.approval_boundary_json),
    noDataPolicy: row.no_data_policy,
    staleDataPolicy: row.stale_data_policy,
    retryPolicy: JSON.parse(row.retry_policy_json),
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createRoutine(
  store: StateStore,
  input: {
    readonly id: string;
    readonly ownerStaffId?: string;
    readonly triggerKind: RoutineTriggerKind;
    readonly trigger: unknown;
    readonly workflow: unknown;
    readonly inputSourceIds?: readonly string[];
    readonly expectedOutput: string;
    readonly executionPolicy?: unknown;
    readonly approvalBoundary?: unknown;
    readonly noDataPolicy?: string;
    readonly staleDataPolicy?: string;
    readonly retryPolicy?: unknown;
    readonly nextRunAt?: string;
    readonly at: string;
  },
): Routine {
  if (!input.expectedOutput.trim()) {
    throw new Error('routine requires expected output');
  }
  store.db
    .prepare(
      `INSERT INTO routines (
         id, owner_staff_id, enabled, trigger_kind, trigger_json, workflow_json,
         input_source_ids_json, expected_output, execution_policy_json,
         approval_boundary_json, no_data_policy, stale_data_policy, retry_policy_json,
         next_run_at, created_at, updated_at
       ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.ownerStaffId ?? null,
      input.triggerKind,
      JSON.stringify(input.trigger ?? {}),
      JSON.stringify(input.workflow ?? {}),
      JSON.stringify(input.inputSourceIds ?? []),
      input.expectedOutput,
      JSON.stringify(input.executionPolicy ?? { mode: 'headless', pin: null }),
      JSON.stringify(input.approvalBoundary ?? { consequential: 'require' }),
      input.noDataPolicy ?? 'skip',
      input.staleDataPolicy ?? 'require-refresh',
      JSON.stringify(input.retryPolicy ?? { maxAttempts: 1 }),
      input.nextRunAt ?? null,
      input.at,
      input.at,
    );
  appendActivity(store, {
    at: input.at,
    kind: 'routine.started',
    payload: { routineId: input.id, triggerKind: input.triggerKind },
  });
  return getRoutine(store, input.id)!;
}

export function getRoutine(store: StateStore, id: string): Routine | null {
  const row = store.db.prepare('SELECT * FROM routines WHERE id = ?').get(id) as Row | undefined;
  return row ? toRoutine(row) : null;
}

export function listRoutines(store: StateStore): Routine[] {
  const rows = store.db
    .prepare('SELECT * FROM routines ORDER BY created_at, id')
    .all() as unknown as Row[];
  return rows.map(toRoutine);
}

export function setRoutineEnabled(
  store: StateStore,
  input: { readonly id: string; readonly enabled: boolean; readonly at: string },
): Routine {
  const existing = getRoutine(store, input.id);
  if (!existing) throw new Error(`routine ${input.id} not found`);
  store.db
    .prepare(`UPDATE routines SET enabled = ?, updated_at = ? WHERE id = ?`)
    .run(input.enabled ? 1 : 0, input.at, input.id);
  appendActivity(store, {
    at: input.at,
    kind: input.enabled ? 'routine.enabled' : 'routine.disabled',
    payload: { routineId: input.id },
  });
  return getRoutine(store, input.id)!;
}

export function markRoutineRun(
  store: StateStore,
  input: {
    readonly id: string;
    readonly at: string;
    readonly nextRunAt?: string | null;
  },
): Routine {
  const existing = getRoutine(store, input.id);
  if (!existing) throw new Error(`routine ${input.id} not found`);
  store.db
    .prepare(
      `UPDATE routines SET last_run_at = ?, next_run_at = COALESCE(?, next_run_at), updated_at = ? WHERE id = ?`,
    )
    .run(input.at, input.nextRunAt ?? null, input.at, input.id);
  appendActivity(store, {
    at: input.at,
    kind: 'routine.ran',
    payload: { routineId: input.id },
  });
  return getRoutine(store, input.id)!;
}
