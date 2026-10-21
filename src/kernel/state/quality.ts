/** Bound-step/check friction and latest accepted host application reports.
 * Neither assignment, application reports nor observed commands establish method effectiveness. */

import type { StateStore } from './open.ts';
import { parseJson } from './rows.ts';

export interface SkillQuality {
  readonly basis: 'bound_step_checks';
  readonly applicationReports: {
    readonly applied: number;
    readonly skipped: number;
    readonly deferred: number;
    readonly unreported: number;
  };
  readonly observedExecutionSteps: number;
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
  const steps = store.db
    .prepare(`SELECT id, run_id, state, attempts, input_json, output_json FROM step_runs ORDER BY run_id, ordinal`)
    .all() as unknown as {
    id: string;
    run_id: string;
    state: string;
    attempts: number;
    input_json: string | null;
    output_json: string | null;
  }[];
  const failures = store.db
    .prepare(`SELECT step_run_id, payload_json FROM activity_events WHERE kind = 'step.validation_failed'`)
    .all() as unknown as { step_run_id: string | null; payload_json: string }[];
  const failingByStep = new Map<string, string[]>();
  for (const f of failures) {
    if (!f.step_run_id) continue;
    const names = (parseJson(f.payload_json) as { failures?: unknown } | null)?.failures;
    if (Array.isArray(names))
      failingByStep.set(f.step_run_id, [
        ...(failingByStep.get(f.step_run_id) ?? []),
        ...names.filter((n): n is string => typeof n === 'string'),
      ]);
  }
  const groups = new Map<
    string,
    {
      applicationReports: { applied: number; skipped: number; deferred: number; unreported: number };
      observedExecutionSteps: number;
      skill: string;
      version: string;
      steps: number;
      succeeded: number;
      firstPass: number;
      attempts: number;
      waived: number;
      failed: number;
      checks: Map<string, number>;
    }
  >();
  const group = (skill: { id: string; version: string }) => {
    const key = `${skill.id}@${skill.version}`;
    const existing = groups.get(key);
    if (existing) return existing;
    const value = {
      skill: skill.id,
      version: skill.version,
      steps: 0,
      succeeded: 0,
      firstPass: 0,
      attempts: 0,
      waived: 0,
      failed: 0,
      checks: new Map<string, number>(),
      applicationReports: { applied: 0, skipped: 0, deferred: 0, unreported: 0 },
      observedExecutionSteps: 0,
    };
    groups.set(key, value);
    return value;
  };
  const reports = new Map<string, { skill: { id: string; version: string }; status: string }>();
  for (const st of steps) {
    if (st.state === 'pending' || st.state === 'ready') continue;
    const skill = (parseJson(st.input_json) as { skill?: { id?: unknown; version?: unknown } | null } | null)?.skill;
    const output = parseJson(st.output_json) as {
      waived?: unknown;
      methodReceipts?: { provenance?: string; methods?: { id: string; version: string; status: string }[] };
      executionVerification?: { ok?: boolean; observed?: unknown };
    } | null;
    // Raw output.methods is a host input. Only the kernel's accepted receipt participates.
    if (st.state === 'succeeded' && output?.methodReceipts?.provenance === 'host_report') {
      for (const report of output.methodReceipts.methods ?? []) {
        if (typeof report.id !== 'string' || typeof report.version !== 'string') continue;
        const key = `${st.run_id}:${report.id}:${report.version}`;
        if (report.status !== 'unreported' || !reports.has(key))
          reports.set(key, { skill: { id: report.id, version: report.version }, status: report.status });
      }
    }
    if (!skill || typeof skill.id !== 'string' || typeof skill.version !== 'string') continue;
    const typed = { id: skill.id, version: skill.version };
    const key = `${st.run_id}:${skill.id}:${skill.version}`;
    if (!reports.has(key)) reports.set(key, { skill: typed, status: 'unreported' });
    const g = group(typed);
    if (st.state === 'succeeded' && output?.executionVerification?.ok === true && output.executionVerification.observed)
      g.observedExecutionSteps += 1;
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
  }
  for (const { skill, status } of reports.values()) {
    const g = group(skill);
    const category =
      status === 'reported_applied'
        ? 'applied'
        : status === 'reported_skipped'
          ? 'skipped'
          : status === 'reported_deferred'
            ? 'deferred'
            : 'unreported';
    g.applicationReports[category] += 1;
  }
  return [...groups.values()]
    .filter((g) => !filter.skill || g.skill === filter.skill)
    .map((g) => ({
      basis: 'bound_step_checks' as const,
      applicationReports: g.applicationReports,
      observedExecutionSteps: g.observedExecutionSteps,
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
