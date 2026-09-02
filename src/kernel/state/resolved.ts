/**
 * kernel/state/resolved.ts — which skill and workflow versions this project resolved.
 *
 * The registry decides what resolves; this records the answer so status and
 * doctor can compare it with the lockfile and the installed package.
 */

import type { StateStore } from './open.ts';
import { requireInstant, requireNonEmpty, requireOneOf } from './rows.ts';

export const BUNDLE_ORIGINS = ['builtin', 'project'] as const;
export type BundleOrigin = (typeof BUNDLE_ORIGINS)[number];

export interface ResolvedBundle {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
  readonly origin: BundleOrigin;
  readonly resolvedAt: string;
}

type Table = 'resolved_skills' | 'resolved_workflows';

function record(
  store: StateStore,
  table: Table,
  idColumn: 'skill_id' | 'workflow_id',
  input: ResolvedBundle,
): void {
  requireNonEmpty(input.id, `${table}.id`);
  requireNonEmpty(input.version, `${table}.version`);
  requireNonEmpty(input.digest, `${table}.digest`);
  requireOneOf(input.origin, BUNDLE_ORIGINS, `${table}.origin`);
  requireInstant(input.resolvedAt, `${table}.resolvedAt`);
  store.db
    .prepare(
      `INSERT INTO ${table} (${idColumn}, version, digest, origin, resolved_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(${idColumn}) DO UPDATE SET
         version = excluded.version, digest = excluded.digest, origin = excluded.origin, resolved_at = excluded.resolved_at`,
    )
    .run(input.id, input.version, input.digest, input.origin, input.resolvedAt);
}

function list(store: StateStore, table: Table, idColumn: 'skill_id' | 'workflow_id'): ResolvedBundle[] {
  const rows = store.db
    .prepare(`SELECT ${idColumn} AS id, version, digest, origin, resolved_at FROM ${table} ORDER BY ${idColumn}`)
    .all() as unknown as Array<{ id: string; version: string; digest: string; origin: BundleOrigin; resolved_at: string }>;
  return rows.map((r) => ({ id: r.id, version: r.version, digest: r.digest, origin: r.origin, resolvedAt: r.resolved_at }));
}

export function recordResolvedSkill(store: StateStore, input: ResolvedBundle): void {
  record(store, 'resolved_skills', 'skill_id', input);
}
export function recordResolvedWorkflow(store: StateStore, input: ResolvedBundle): void {
  record(store, 'resolved_workflows', 'workflow_id', input);
}
export function listResolvedSkills(store: StateStore): ResolvedBundle[] {
  return list(store, 'resolved_skills', 'skill_id');
}
export function listResolvedWorkflows(store: StateStore): ResolvedBundle[] {
  return list(store, 'resolved_workflows', 'workflow_id');
}
export function forgetResolvedSkill(store: StateStore, id: string): void {
  store.db.prepare('DELETE FROM resolved_skills WHERE skill_id = ?').run(id);
}
export function forgetResolvedWorkflow(store: StateStore, id: string): void {
  store.db.prepare('DELETE FROM resolved_workflows WHERE workflow_id = ?').run(id);
}
