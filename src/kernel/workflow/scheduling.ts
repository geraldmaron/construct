/** Persist the user's standing intent. Clock installation and executor provisioning
 * are separate host actions; recording a trigger never starts a model or a run.
 */
import { createHash } from 'node:crypto';
import type { StateStore } from '../state/open.ts';
import type { RegisteredWorkflow } from '../registry/models.ts';
import type { Intake } from './intake.ts';
import type { TriggerService } from './triggers.ts';
import { tierRank } from '../policy/lattice.ts';

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export function scheduleIntake(store: StateStore, service: TriggerService, workflow: RegisteredWorkflow, intake: Intake, input: Record<string, unknown>) {
  if (intake.kind !== 'maintain' || !intake.schedule || (!intake.schedule.cron && !intake.schedule.event)) throw new Error('a standing outcome needs a schedule or event');
  if (workflow.manifest.steps.some((step) => tierRank(step.tier) > tierRank('project_write'))) throw new Error('standing intake cannot authorize external, destructive or licensed actions; define an explicitly bounded workflow first');
  const schedule = intake.schedule;
  return store.transaction(() => {
    const triggers = (['schedule', 'event'] as const).flatMap((kind) => {
      if (kind === 'schedule' ? !schedule.cron : !schedule.event) return [];
      const definition = { workflowId: workflow.manifest.id, kind, scheduleExpression: kind === 'schedule' ? schedule.cron! : undefined, timezone: kind === 'schedule' ? schedule.timezone! : undefined, eventName: kind === 'event' ? schedule.event! : undefined, adapter: kind === 'schedule' ? 'cron' as const : 'host' as const, overlap: 'skip' as const, maxTier: 'project_write' as const, input, delivery: { destination: 'inbox', intake } };
      const id = 'trigger-' + createHash('sha256').update(canonical(definition)).digest('hex').slice(0, 24);
      const existing = service.get(id);
      return [{ trigger: existing ?? service.define({ ...definition, id }), created: !existing }];
    });
    return { started: false, recorded: true, scheduled: true, triggers, provisioning: { clock: 'unprovisioned', executor: 'unprovisioned' }, next: 'The standing intent is saved; no clock or executor was installed, no immediate run started, and no future execution is promised. Use workflow executors and workflow recipe <trigger-id> --executor=<supported-id> to prepare an explicit host handoff with persistent state. For an event, provision an authorized event sender. Report these limits to the person.' };
  });
}
