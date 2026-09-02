/**
 * kernel/state/grants.ts — scoped permission grants and break-glass records.
 *
 * A standing grant names an action tier and a target system, and may narrow
 * further by resource, workflow, executor, impact, budget, and time. A
 * break-glass grant must name its exact resource and executor, carry a reason,
 * and expire soon. Nothing here decides; the policy engine reads these rows.
 */

import type { StateStore } from './open.ts';
import { appendActivity } from './activity.ts';
import { boolFrom, requireInstant, requireNonEmpty, requireOneOf } from './rows.ts';
import { ACTION_TIERS, type ActionTier } from './steps.ts';

/** Tiers a grant can carry. Licensed judgment is never grantable. */
export const GRANTABLE_TIERS = ACTION_TIERS.filter((t) => t !== 'licensed_judgment') as readonly Exclude<
  ActionTier,
  'licensed_judgment'
>[];
export type GrantableTier = (typeof GRANTABLE_TIERS)[number];

export const MAX_BREAK_GLASS_TTL_MS = 4 * 3_600_000;

export interface Grant {
  readonly id: string;
  readonly actionTier: GrantableTier;
  readonly targetSystem: string;
  readonly targetResource: string | null;
  readonly workflowId: string | null;
  readonly executorId: string | null;
  readonly maxImpact: string | null;
  readonly budgetCents: number | null;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly grantedBy: string;
  readonly breakGlass: boolean;
  readonly reason: string | null;
  readonly revokedAt: string | null;
  readonly revokedReason: string | null;
  readonly createdAt: string;
}

interface Row {
  readonly id: string;
  readonly action_tier: GrantableTier;
  readonly target_system: string;
  readonly target_resource: string | null;
  readonly workflow_id: string | null;
  readonly executor_id: string | null;
  readonly max_impact: string | null;
  readonly budget_cents: number | null;
  readonly starts_at: string;
  readonly ends_at: string | null;
  readonly granted_by: string;
  readonly break_glass: number;
  readonly reason: string | null;
  readonly revoked_at: string | null;
  readonly revoked_reason: string | null;
  readonly created_at: string;
}

function toGrant(row: Row): Grant {
  return {
    id: row.id,
    actionTier: row.action_tier,
    targetSystem: row.target_system,
    targetResource: row.target_resource,
    workflowId: row.workflow_id,
    executorId: row.executor_id,
    maxImpact: row.max_impact,
    budgetCents: row.budget_cents,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    grantedBy: row.granted_by,
    breakGlass: boolFrom(row.break_glass),
    reason: row.reason,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
    createdAt: row.created_at,
  };
}

export interface CreateGrantInput {
  readonly id: string;
  readonly actionTier: GrantableTier;
  readonly targetSystem: string;
  readonly targetResource?: string;
  readonly workflowId?: string;
  readonly executorId?: string;
  readonly maxImpact?: string;
  readonly budgetCents?: number;
  readonly startsAt: string;
  readonly endsAt?: string;
  readonly grantedBy: string;
  readonly breakGlass?: boolean;
  readonly reason?: string;
  readonly at: string;
}

export function createGrant(store: StateStore, input: CreateGrantInput): Grant {
  requireNonEmpty(input.id, 'grant.id');
  requireOneOf(input.actionTier, GRANTABLE_TIERS, 'grant.actionTier');
  requireNonEmpty(input.targetSystem, 'grant.targetSystem');
  requireNonEmpty(input.grantedBy, 'grant.grantedBy');
  requireInstant(input.startsAt, 'grant.startsAt');
  requireInstant(input.at, 'grant.at');
  if (input.endsAt !== undefined) {
    requireInstant(input.endsAt, 'grant.endsAt');
    if (input.endsAt <= input.startsAt) throw new Error('grant.endsAt must be after grant.startsAt');
  }
  if (input.budgetCents !== undefined && (!Number.isInteger(input.budgetCents) || input.budgetCents < 0)) {
    throw new Error('grant.budgetCents must be a non-negative integer');
  }
  const breakGlass = input.breakGlass === true;
  if (breakGlass) {
    if (!input.reason?.trim()) throw new Error('a break-glass grant needs a reason');
    if (!input.targetResource?.trim()) throw new Error('a break-glass grant names its exact target resource');
    if (!input.executorId?.trim()) throw new Error('a break-glass grant names the one executor it is for');
    if (input.endsAt === undefined) throw new Error('a break-glass grant must expire');
    if (Date.parse(input.endsAt) - Date.parse(input.startsAt) > MAX_BREAK_GLASS_TTL_MS) {
      throw new Error(`a break-glass grant lasts at most ${String(MAX_BREAK_GLASS_TTL_MS / 3_600_000)} hours`);
    }
  }
  return store.transaction(() => {
    const row = store.db
      .prepare(
        `INSERT INTO grants
           (id, action_tier, target_system, target_resource, workflow_id, executor_id, max_impact, budget_cents,
            starts_at, ends_at, granted_by, break_glass, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        input.id,
        input.actionTier,
        input.targetSystem,
        input.targetResource ?? null,
        input.workflowId ?? null,
        input.executorId ?? null,
        input.maxImpact ?? null,
        input.budgetCents ?? null,
        input.startsAt,
        input.endsAt ?? null,
        input.grantedBy,
        breakGlass ? 1 : 0,
        input.reason ?? null,
        input.at,
      ) as unknown as Row;
    appendActivity(store, {
      at: input.at,
      kind: breakGlass ? 'grant.break_glass' : 'grant.created',
      actor: input.grantedBy,
      payload: {
        grantId: input.id,
        actionTier: input.actionTier,
        targetSystem: input.targetSystem,
        targetResource: input.targetResource ?? null,
        executorId: input.executorId ?? null,
        endsAt: input.endsAt ?? null,
        reason: input.reason ?? null,
      },
    });
    return toGrant(row);
  });
}

export function getGrant(store: StateStore, id: string): Grant | null {
  const row = store.db.prepare('SELECT * FROM grants WHERE id = ?').get(id) as Row | undefined;
  return row ? toGrant(row) : null;
}

export function revokeGrant(
  store: StateStore,
  input: { readonly id: string; readonly reason: string; readonly by: string; readonly at: string },
): Grant {
  requireInstant(input.at, 'grant.at');
  return store.transaction(() => {
    const result = store.db
      .prepare(`UPDATE grants SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL`)
      .run(input.at, input.reason, input.id);
    if (result.changes === 0) throw new Error(`no active grant ${input.id} to revoke`);
    appendActivity(store, {
      at: input.at,
      kind: 'grant.revoked',
      actor: input.by,
      payload: { grantId: input.id, reason: input.reason },
    });
    return getGrant(store, input.id)!;
  });
}

export interface GrantQuery {
  readonly actionTier: ActionTier;
  readonly targetSystem: string;
  readonly targetResource?: string;
  readonly workflowId?: string;
  readonly executorId?: string;
  readonly at: string;
}

/**
 * Grants that cover a request at `at`. A standing grant's NULL scope means
 * any; a break-glass grant matches only its exact resource and executor.
 * Licensed judgment is never covered.
 */
export function coveringGrants(store: StateStore, query: GrantQuery): Grant[] {
  requireInstant(query.at, 'grant.at');
  if (query.actionTier === 'licensed_judgment') return [];
  const rows = store.db
    .prepare(
      `SELECT * FROM grants
        WHERE action_tier = ? AND target_system = ?
          AND revoked_at IS NULL AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)
          AND (target_resource IS NULL OR target_resource = ?)
          AND (workflow_id IS NULL OR workflow_id = ?)
          AND (executor_id IS NULL OR executor_id = ?)
        ORDER BY break_glass, created_at, id`,
    )
    .all(
      query.actionTier,
      query.targetSystem,
      query.at,
      query.at,
      query.targetResource ?? null,
      query.workflowId ?? null,
      query.executorId ?? null,
    ) as unknown as Row[];
  return rows.map(toGrant);
}

export function listGrants(
  store: StateStore,
  filter: { readonly activeAt?: string } = {},
): Grant[] {
  const rows =
    filter.activeAt === undefined
      ? (store.db.prepare('SELECT * FROM grants ORDER BY created_at, id').all() as unknown as Row[])
      : (store.db
          .prepare(
            `SELECT * FROM grants
              WHERE revoked_at IS NULL AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)
              ORDER BY created_at, id`,
          )
          .all(filter.activeAt, filter.activeAt) as unknown as Row[]);
  return rows.map(toGrant);
}
