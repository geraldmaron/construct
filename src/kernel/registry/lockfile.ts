/**
 * kernel/registry/lockfile.ts — the committed lock against the registry:
 * which bundles are current, outdated, diverged, missing, or not yet locked,
 * and how to bring the lock up to date without overwriting a project's own
 * bundles unasked.
 */

import type { LockedBundle, RegistryLock } from '../project/lock.ts';
import { LOCK_FORMAT, LOCK_VERSION } from '../project/lock.ts';
import { compareVersions, parseVersion } from './semver.ts';
import type { RegisteredSkill, RegisteredWorkflow } from './models.ts';

export const LOCK_STATES = ['current', 'outdated', 'diverged', 'missing', 'unlocked', 'blocked'] as const;
export type LockState = (typeof LOCK_STATES)[number];

export interface LockRow {
  readonly kind: 'skill' | 'workflow';
  readonly id: string;
  readonly state: LockState;
  readonly locked: LockedBundle | null;
  readonly registry: { readonly version: string; readonly digest: string; readonly origin: 'builtin' | 'project' } | null;
  readonly why: string;
}

function compare(kind: 'skill' | 'workflow', id: string, locked: LockedBundle | undefined, live: { version: string; digest: string; origin: 'builtin' | 'project' } | undefined): LockRow {
  if (!locked && !live) return { kind, id, state: 'missing', locked: null, registry: null, why: 'neither locked nor present' };
  if (!locked) return { kind, id, state: 'unlocked', locked: null, registry: live!, why: `present at ${live!.version} but not in the lock` };
  if (!live) return { kind, id, state: 'missing', locked, registry: null, why: `locked at ${locked.version} but no longer present` };
  if (locked.digest === live.digest && locked.version === live.version) return { kind, id, state: 'current', locked, registry: live, why: 'lock and registry agree' };
  const lv = parseVersion(locked.version);
  const rv = parseVersion(live.version);
  if (lv && rv && compareVersions(rv, lv) > 0) return { kind, id, state: 'outdated', locked, registry: live, why: `locked at ${locked.version}; ${live.version} is present` };
  if (lv && rv && compareVersions(rv, lv) < 0) return { kind, id, state: 'blocked', locked, registry: live, why: `locked at ${locked.version} but only ${live.version} is present` };
  return { kind, id, state: 'diverged', locked, registry: live, why: `version ${live.version} is locked with a different digest; its content changed without a version bump` };
}

export function lockStatus(lock: RegistryLock, skills: readonly RegisteredSkill[], workflows: readonly RegisteredWorkflow[]): LockRow[] {
  const rows: LockRow[] = [];
  const skillIds = new Set([...Object.keys(lock.skills), ...skills.map((s) => s.manifest.id)]);
  for (const id of [...skillIds].sort()) {
    const live = skills.find((s) => s.manifest.id === id);
    rows.push(compare('skill', id, lock.skills[id], live ? { version: live.manifest.version, digest: live.digest, origin: live.origin } : undefined));
  }
  const workflowIds = new Set([...Object.keys(lock.workflows), ...workflows.map((w) => w.manifest.id)]);
  for (const id of [...workflowIds].sort()) {
    const live = workflows.find((w) => w.manifest.id === id);
    rows.push(compare('workflow', id, lock.workflows[id], live ? { version: live.manifest.version, digest: live.digest, origin: live.origin } : undefined));
  }
  return rows;
}

export interface UpdateLockOptions {
  /** Project-authored bundles whose lock entry may be replaced. Others are reported, not changed. */
  readonly confirmProjectBundles?: readonly string[];
}

export interface UpdateLockResult {
  readonly lock: RegistryLock;
  readonly changed: readonly string[];
  readonly needsConfirmation: readonly string[];
  readonly removed: readonly string[];
}

/**
 * Bring the lock up to the registry. Built-in bundles update freely; a
 * project-authored bundle whose lock entry would change is left alone until
 * named in `confirmProjectBundles`, so an edit nobody meant to lock is
 * never locked silently.
 */
export function updateLock(lock: RegistryLock, skills: readonly RegisteredSkill[], workflows: readonly RegisteredWorkflow[], options: UpdateLockOptions = {}): UpdateLockResult {
  const confirm = new Set(options.confirmProjectBundles ?? []);
  const nextSkills: Record<string, LockedBundle> = {};
  const nextWorkflows: Record<string, LockedBundle> = {};
  const changed: string[] = [];
  const needs: string[] = [];
  const removed: string[] = [];
  for (const row of lockStatus(lock, skills, workflows)) {
    const target = row.kind === 'skill' ? nextSkills : nextWorkflows;
    if (row.state === 'missing' && row.locked) {
      removed.push(`${row.kind}:${row.id}`);
      continue;
    }
    if (!row.registry) continue;
    const fresh: LockedBundle = { version: row.registry.version, digest: row.registry.digest, origin: row.registry.origin };
    if (row.state === 'current') {
      target[row.id] = row.locked!;
      continue;
    }
    if (row.registry.origin === 'project' && row.locked && !confirm.has(row.id)) {
      target[row.id] = row.locked;
      needs.push(`${row.kind}:${row.id}`);
      continue;
    }
    target[row.id] = fresh;
    changed.push(`${row.kind}:${row.id}`);
  }
  return {
    lock: { format: LOCK_FORMAT, formatVersion: LOCK_VERSION, skills: nextSkills, workflows: nextWorkflows },
    changed,
    needsConfirmation: needs,
    removed,
  };
}
