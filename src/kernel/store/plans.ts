/**
 * kernel/store/plans.ts — persistence for the run's plan. One plan per run,
 * write-once: the plan is the recorded understanding the run worked from, and
 * a record that can be rewritten after the work is not a record. Replanning
 * is a new run.
 */

import type { Store } from './open.ts';
import type { Plan } from '../plan/schema.ts';

export function recordPlan(store: Store, plan: Plan): void {
  store.db
    .prepare('INSERT INTO plans (id, run, plan, planned_at) VALUES (?, ?, ?, ?)')
    .run(plan.id, plan.run, JSON.stringify(plan), plan.plannedAt);
}

export function planFor(store: Store, run: string): Plan | null {
  const row = store.db.prepare('SELECT plan FROM plans WHERE run = ?').get(run) as
    | { plan: string }
    | undefined;
  return row ? (JSON.parse(row.plan) as Plan) : null;
}
