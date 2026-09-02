/**
 * kernel/state/triggers.ts — standing outcomes and their firing ledger.
 *
 * A trigger is a definition; an external clock fires it. Every firing is
 * recorded under an idempotency key, so the same tick fired twice starts one
 * run, and every skip says why.
 */

import type { StateStore } from './open.ts';
import { appendActivity } from './activity.ts';
import { parseJson, requireInstant, requireNonEmpty, requireOneOf, toJson } from './rows.ts';
import { ACTION_TIERS, type ActionTier } from './steps.ts';

export const TRIGGER_ADAPTERS = ['manual', 'cron', 'ci', 'host'] as const;
export type TriggerAdapter = (typeof TRIGGER_ADAPTERS)[number];

export const OVERLAP_POLICIES = ['skip', 'queue', 'replace'] as const;
export type OverlapPolicy = (typeof OVERLAP_POLICIES)[number];

export const FIRING_OUTCOMES = ['started', 'skipped_overlap', 'replaced', 'deduplicated', 'blocked', 'disabled'] as const;
export type FiringOutcome = (typeof FIRING_OUTCOMES)[number];

export interface Trigger {
  readonly id: string;
  readonly workflowId: string;
  readonly kind: 'manual' | 'schedule' | 'event';
  readonly scheduleExpression: string | null;
  readonly timezone: string | null;
  readonly eventName: string | null;
  readonly adapter: TriggerAdapter;
  readonly enabled: boolean;
  readonly overlap: OverlapPolicy;
  readonly maxTier: ActionTier;
  readonly delivery: unknown;
  readonly input: unknown;
  readonly lastFiredAt: string | null;
  readonly nextDueAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface Row {
  readonly id: string;
  readonly workflow_id: string;
  readonly kind: Trigger['kind'];
  readonly schedule_expression: string | null;
  readonly timezone: string | null;
  readonly event_name: string | null;
  readonly adapter: TriggerAdapter;
  readonly enabled: number;
  readonly overlap: OverlapPolicy;
  readonly max_tier: ActionTier;
  readonly delivery_json: string;
  readonly input_json: string;
  readonly last_fired_at: string | null;
  readonly next_due_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

function toTrigger(row: Row): Trigger {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    kind: row.kind,
    scheduleExpression: row.schedule_expression,
    timezone: row.timezone,
    eventName: row.event_name,
    adapter: row.adapter,
    enabled: row.enabled === 1,
    overlap: row.overlap,
    maxTier: row.max_tier,
    delivery: parseJson(row.delivery_json),
    input: parseJson(row.input_json),
    lastFiredAt: row.last_fired_at,
    nextDueAt: row.next_due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateTriggerInput {
  readonly id: string;
  readonly workflowId: string;
  readonly kind: Trigger['kind'];
  readonly scheduleExpression?: string;
  readonly timezone?: string;
  readonly eventName?: string;
  readonly adapter: TriggerAdapter;
  readonly overlap: OverlapPolicy;
  readonly maxTier: ActionTier;
  readonly delivery: unknown;
  readonly input: unknown;
  readonly nextDueAt?: string;
  readonly at: string;
}

export function createTrigger(store: StateStore, input: CreateTriggerInput): Trigger {
  requireNonEmpty(input.id, 'trigger.id');
  requireNonEmpty(input.workflowId, 'trigger.workflowId');
  requireOneOf(input.kind, ['manual', 'schedule', 'event'] as const, 'trigger.kind');
  requireOneOf(input.adapter, TRIGGER_ADAPTERS, 'trigger.adapter');
  requireOneOf(input.overlap, OVERLAP_POLICIES, 'trigger.overlap');
  requireOneOf(input.maxTier, ACTION_TIERS, 'trigger.maxTier');
  requireInstant(input.at, 'trigger.at');
  if (input.kind === 'schedule' && (!input.scheduleExpression || !input.timezone)) throw new Error('a schedule trigger needs a schedule expression and a timezone');
  if (input.kind === 'event' && !input.eventName) throw new Error('an event trigger names its event');
  if (input.maxTier === 'licensed_judgment') throw new Error('a trigger cannot reach licensed judgment');
  return store.transaction(() => {
    const row = store.db
      .prepare(
        `INSERT INTO triggers (id, workflow_id, kind, schedule_expression, timezone, event_name, adapter, enabled, overlap, max_tier,
                               delivery_json, input_json, next_due_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        input.id, input.workflowId, input.kind, input.scheduleExpression ?? null, input.timezone ?? null, input.eventName ?? null,
        input.adapter, input.overlap, input.maxTier, toJson(input.delivery ?? {}), toJson(input.input ?? {}), input.nextDueAt ?? null, input.at, input.at,
      ) as unknown as Row;
    appendActivity(store, { at: input.at, kind: 'trigger.created', payload: { triggerId: input.id, workflowId: input.workflowId, kind: input.kind } });
    return toTrigger(row);
  });
}

export function getTrigger(store: StateStore, id: string): Trigger | null {
  const row = store.db.prepare('SELECT * FROM triggers WHERE id = ?').get(id) as Row | undefined;
  return row ? toTrigger(row) : null;
}

export function listTriggers(store: StateStore, filter: { readonly workflowId?: string; readonly enabled?: boolean } = {}): Trigger[] {
  const rows = store.db
    .prepare(`SELECT * FROM triggers WHERE (? IS NULL OR workflow_id = ?) AND (? IS NULL OR enabled = ?) ORDER BY created_at, id`)
    .all(filter.workflowId ?? null, filter.workflowId ?? null, filter.enabled === undefined ? null : filter.enabled ? 1 : 0, filter.enabled === undefined ? null : filter.enabled ? 1 : 0) as unknown as Row[];
  return rows.map(toTrigger);
}

export function setTriggerEnabled(store: StateStore, id: string, enabled: boolean, at: string): Trigger {
  requireInstant(at, 'trigger.at');
  const result = store.db.prepare('UPDATE triggers SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, at, id);
  if (result.changes === 0) throw new Error(`no trigger ${id}`);
  return getTrigger(store, id)!;
}

export function markTriggerFired(store: StateStore, id: string, at: string, nextDueAt: string | null): Trigger {
  requireInstant(at, 'trigger.at');
  const result = store.db.prepare('UPDATE triggers SET last_fired_at = ?, next_due_at = ?, updated_at = ? WHERE id = ?').run(at, nextDueAt, at, id);
  if (result.changes === 0) throw new Error(`no trigger ${id}`);
  return getTrigger(store, id)!;
}

export interface TriggerFiring {
  readonly id: string;
  readonly triggerId: string;
  readonly idempotencyKey: string;
  readonly firedAt: string;
  readonly runId: string | null;
  readonly outcome: FiringOutcome;
  readonly reason: string | null;
}

interface FiringRow {
  readonly id: string;
  readonly trigger_id: string;
  readonly idempotency_key: string;
  readonly fired_at: string;
  readonly run_id: string | null;
  readonly outcome: FiringOutcome;
  readonly reason: string | null;
}

function toFiring(row: FiringRow): TriggerFiring {
  return { id: row.id, triggerId: row.trigger_id, idempotencyKey: row.idempotency_key, firedAt: row.fired_at, runId: row.run_id, outcome: row.outcome, reason: row.reason };
}

/** Record a firing; a repeated key returns the first record and `created: false`. */
export function recordFiring(
  store: StateStore,
  input: { readonly id: string; readonly triggerId: string; readonly idempotencyKey: string; readonly at: string; readonly runId?: string | null; readonly outcome: FiringOutcome; readonly reason?: string },
): { readonly firing: TriggerFiring; readonly created: boolean } {
  requireOneOf(input.outcome, FIRING_OUTCOMES, 'firing.outcome');
  requireInstant(input.at, 'firing.at');
  return store.transaction(() => {
    const existing = store.db.prepare('SELECT * FROM trigger_firings WHERE idempotency_key = ?').get(input.idempotencyKey) as FiringRow | undefined;
    if (existing) return { firing: toFiring(existing), created: false };
    const row = store.db
      .prepare(`INSERT INTO trigger_firings (id, trigger_id, idempotency_key, fired_at, run_id, outcome, reason) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`)
      .get(input.id, input.triggerId, input.idempotencyKey, input.at, input.runId ?? null, input.outcome, input.reason ?? null) as unknown as FiringRow;
    appendActivity(store, { at: input.at, kind: 'trigger.fired', runId: input.runId ?? null, payload: { triggerId: input.triggerId, outcome: input.outcome, reason: input.reason ?? null } });
    return { firing: toFiring(row), created: true };
  });
}

export function listFirings(store: StateStore, triggerId: string, limit = 50): TriggerFiring[] {
  const rows = store.db.prepare('SELECT * FROM trigger_firings WHERE trigger_id = ? ORDER BY fired_at DESC, id LIMIT ?').all(triggerId, Math.max(1, Math.min(limit, 500))) as unknown as FiringRow[];
  return rows.map(toFiring);
}
