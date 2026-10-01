/**
 * kernel/state/quality.ts — how well each skill version's steps do against
 * their checks, measured from what actually happened.
 *
 * A skill earns its place when the steps bound to it pass their checks on
 * the first attempt more often, need fewer attempts, and are waived less.
 * These are the deterministic half of skill impact; whether the output was
 * right is still the person's call and the blind A/B runs'.
 */

import type { StateStore } from './open.ts';
import { parseJson } from './rows.ts';

export interface SkillQuality {
  readonly skill: string;
  readonly version: string;
  readonly steps: number;
  readonly succeeded: number;
  readonly firstPass: number;
  readonly meanAttempts: number;
  readonly waived: number;
  readonly failedOrStopped: number;
  /** Which checks sent its steps back, most frequent first. */
  readonly failingChecks: readonly { readonly validator: string; readonly count: number }[];
}

export function skillQuality(store: StateStore, filter: { readonly skill?: string } = {}): SkillQuality[] {
  const steps = store.db.prepare(`SELECT id, state, attempts, input_json, output_json FROM step_runs WHERE input_json LIKE '%"skill"%'`).all() as unknown as { id: string; state: string; attempts: number; input_json: string | null; output_json: string | null }[];
  const failures = store.db.prepare(`SELECT step_run_id, payload_json FROM activity_events WHERE kind = 'step.validation_failed'`).all() as unknown as { step_run_id: string | null; payload_json: string }[];
  const failingByStep = new Map<string, string[]>();
  for (const f of failures) {
    if (!f.step_run_id) continue;
    const names = (parseJson(f.payload_json) as { failures?: unknown } | null)?.failures;
    if (Array.isArray(names)) failingByStep.set(f.step_run_id, [...(failingByStep.get(f.step_run_id) ?? []), ...names.filter((n): n is string => typeof n === 'string')]);
  }
  const groups = new Map<string, { skill: string; version: string; steps: number; succeeded: number; firstPass: number; attempts: number; waived: number; failed: number; checks: Map<string, number> }>();
  for (const st of steps) {
    const skill = (parseJson(st.input_json) as { skill?: { id?: unknown; version?: unknown } | null } | null)?.skill;
    if (!skill || typeof skill.id !== 'string' || typeof skill.version !== 'string') continue;
    if (filter.skill && skill.id !== filter.skill) continue;
    if (st.state === 'pending' || st.state === 'ready') continue;
    const key = `${skill.id}@${skill.version}`;
    const g = groups.get(key) ?? { skill: skill.id, version: skill.version, steps: 0, succeeded: 0, firstPass: 0, attempts: 0, waived: 0, failed: 0, checks: new Map() };
    const waived = Array.isArray((parseJson(st.output_json) as { waived?: unknown } | null)?.waived);
    g.steps += 1;
    g.attempts += st.attempts;
    if (st.state === 'succeeded') {
      g.succeeded += 1;
      if (st.attempts <= 1 && !waived) g.firstPass += 1;
    }
    if (waived) g.waived += 1;
    if (st.state === 'failed' || st.state === 'cancelled') g.failed += 1;
    for (const v of failingByStep.get(st.id) ?? []) g.checks.set(v, (g.checks.get(v) ?? 0) + 1);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({
      skill: g.skill,
      version: g.version,
      steps: g.steps,
      succeeded: g.succeeded,
      firstPass: g.firstPass,
      meanAttempts: g.steps ? Number((g.attempts / g.steps).toFixed(2)) : 0,
      waived: g.waived,
      failedOrStopped: g.failed,
      failingChecks: [...g.checks.entries()].sort((a, b) => b[1] - a[1]).map(([validator, count]) => ({ validator, count })),
    }))
    .sort((a, b) => a.skill.localeCompare(b.skill) || a.version.localeCompare(b.version));
}
