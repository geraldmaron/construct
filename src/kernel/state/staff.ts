/**
 * kernel/state/staff.ts — staff members and their capability and skill assignments.
 */

import type { StateStore } from './open.ts';
import { requireInstant, requireNonEmpty, requireOneOf } from './rows.ts';

export const STAFF_STATUSES = ['active', 'paused', 'retired'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export interface StaffMember {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly mission: string;
  readonly status: StaffStatus;
  readonly capabilities: readonly string[];
  readonly skillIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface Row {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly mission: string;
  readonly status: StaffStatus;
  readonly created_at: string;
  readonly updated_at: string;
}

function assignments(store: StateStore, id: string): { capabilities: string[]; skillIds: string[] } {
  const caps = store.db
    .prepare('SELECT capability FROM staff_capabilities WHERE staff_id = ? ORDER BY capability')
    .all(id) as unknown as Array<{ capability: string }>;
  const skills = store.db
    .prepare('SELECT skill_id FROM staff_skills WHERE staff_id = ? ORDER BY skill_id')
    .all(id) as unknown as Array<{ skill_id: string }>;
  return { capabilities: caps.map((c) => c.capability), skillIds: skills.map((s) => s.skill_id) };
}

function toStaff(store: StateStore, row: Row): StaffMember {
  const { capabilities, skillIds } = assignments(store, row.id);
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    mission: row.mission,
    status: row.status,
    capabilities,
    skillIds,
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
    readonly capabilities?: readonly string[];
    readonly skillIds?: readonly string[];
    readonly at: string;
  },
): StaffMember {
  requireNonEmpty(input.id, 'staff.id');
  requireNonEmpty(input.name, 'staff.name');
  requireNonEmpty(input.title, 'staff.title');
  requireNonEmpty(input.mission, 'staff.mission');
  requireInstant(input.at, 'staff.at');
  return store.transaction(() => {
    store.db
      .prepare(
        `INSERT INTO staff_members (id, name, title, mission, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(input.id, input.name, input.title, input.mission, input.at, input.at);
    setAssignments(store, input.id, input.capabilities ?? [], input.skillIds ?? [], input.at);
    return getStaffMember(store, input.id)!;
  });
}

export function getStaffMember(store: StateStore, id: string): StaffMember | null {
  const row = store.db.prepare('SELECT * FROM staff_members WHERE id = ?').get(id) as Row | undefined;
  return row ? toStaff(store, row) : null;
}

export function listStaffMembers(
  store: StateStore,
  filter: { readonly status?: StaffStatus } = {},
): StaffMember[] {
  const rows = store.db
    .prepare(`SELECT * FROM staff_members WHERE (? IS NULL OR status = ?) ORDER BY created_at, id`)
    .all(filter.status ?? null, filter.status ?? null) as unknown as Row[];
  return rows.map((row) => toStaff(store, row));
}

export function setStaffStatus(store: StateStore, id: string, status: StaffStatus, at: string): StaffMember {
  requireOneOf(status, STAFF_STATUSES, 'staff.status');
  requireInstant(at, 'staff.at');
  const result = store.db
    .prepare('UPDATE staff_members SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, at, id);
  if (result.changes === 0) throw new Error(`no staff member ${id}`);
  return getStaffMember(store, id)!;
}

/** Replace a member's capability and skill assignments wholesale. */
export function setAssignments(
  store: StateStore,
  id: string,
  capabilities: readonly string[],
  skillIds: readonly string[],
  at: string,
): StaffMember {
  requireInstant(at, 'staff.at');
  return store.transaction(() => {
    const exists = store.db.prepare('SELECT 1 FROM staff_members WHERE id = ?').get(id);
    if (!exists) throw new Error(`no staff member ${id}`);
    store.db.prepare('DELETE FROM staff_capabilities WHERE staff_id = ?').run(id);
    store.db.prepare('DELETE FROM staff_skills WHERE staff_id = ?').run(id);
    const putCap = store.db.prepare('INSERT INTO staff_capabilities (staff_id, capability) VALUES (?, ?)');
    for (const cap of new Set(capabilities)) putCap.run(id, requireNonEmpty(cap, 'staff.capability'));
    const putSkill = store.db.prepare('INSERT INTO staff_skills (staff_id, skill_id) VALUES (?, ?)');
    for (const skill of new Set(skillIds)) putSkill.run(id, requireNonEmpty(skill, 'staff.skillId'));
    store.db.prepare('UPDATE staff_members SET updated_at = ? WHERE id = ?').run(at, id);
    return getStaffMember(store, id)!;
  });
}
