/**
 * kernel/state/staff.ts — durable StaffMember ownership for format v1.
 *
 * StaffMember ≠ Concern ≠ Skill ≠ Executor. A member may use different
 * executors over time; identity and mission stay stable.
 */

import type { StateStore } from './open.ts';
import { appendActivity } from './deliverables.ts';

export type StaffStatus = 'active' | 'paused' | 'retired';

export interface StaffMember {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly mission: string;
  readonly concerns: readonly string[];
  readonly skillIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly executionPolicy: unknown;
  readonly approvalPolicy: unknown;
  readonly status: StaffStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface Row {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly mission: string;
  readonly concerns_json: string;
  readonly skill_ids_json: string;
  readonly source_ids_json: string;
  readonly execution_policy_json: string;
  readonly approval_policy_json: string;
  readonly status: StaffStatus;
  readonly created_at: string;
  readonly updated_at: string;
}

function parseArray(raw: string): string[] {
  const value = JSON.parse(raw) as unknown;
  return Array.isArray(value) ? value.map(String) : [];
}

function toStaff(row: Row): StaffMember {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    mission: row.mission,
    concerns: parseArray(row.concerns_json),
    skillIds: parseArray(row.skill_ids_json),
    sourceIds: parseArray(row.source_ids_json),
    executionPolicy: JSON.parse(row.execution_policy_json),
    approvalPolicy: JSON.parse(row.approval_policy_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createStaffMember(
  store: StateStore,
  input: {
    readonly id: string;
    readonly name: string;
    readonly title: string;
    readonly mission: string;
    readonly concerns?: readonly string[];
    readonly skillIds?: readonly string[];
    readonly sourceIds?: readonly string[];
    readonly executionPolicy?: unknown;
    readonly approvalPolicy?: unknown;
    readonly at: string;
  },
): StaffMember {
  store.db
    .prepare(
      `INSERT INTO staff_members (
         id, name, title, mission, concerns_json, skill_ids_json, source_ids_json,
         execution_policy_json, approval_policy_json, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run(
      input.id,
      input.name,
      input.title,
      input.mission,
      JSON.stringify(input.concerns ?? []),
      JSON.stringify(input.skillIds ?? []),
      JSON.stringify(input.sourceIds ?? []),
      JSON.stringify(input.executionPolicy ?? { mode: 'interactive-session' }),
      JSON.stringify(input.approvalPolicy ?? { consequential: 'require' }),
      input.at,
      input.at,
    );
  appendActivity(store, {
    at: input.at,
    kind: 'staff.assigned',
    payload: { staffId: input.id, name: input.name },
  });
  return getStaffMember(store, input.id)!;
}

export function getStaffMember(store: StateStore, id: string): StaffMember | null {
  const row = store.db.prepare('SELECT * FROM staff_members WHERE id = ?').get(id) as
    | Row
    | undefined;
  return row ? toStaff(row) : null;
}

export function listStaffMembers(store: StateStore): StaffMember[] {
  const rows = store.db
    .prepare(`SELECT * FROM staff_members WHERE status != 'retired' ORDER BY name`)
    .all() as unknown as Row[];
  return rows.map(toStaff);
}
