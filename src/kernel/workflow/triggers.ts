/**
 * kernel/workflow/triggers.ts — standing outcomes: define a trigger, let an
 * external clock fire it, keep the ledger, and write the recipe the clock
 * needs. Construct owns what happens on a firing; it never owns time.
 *
 * A trigger's input is checked when it is defined. A period in it is kept
 * relative and worked out at each firing's due time in the trigger's own
 * timezone, so every firing covers its own window.
 */

import type { StateStore } from '../state/open.ts';
import { listActiveRuns } from '../state/runs.ts';
import {
  createTrigger,
  getTrigger,
  listTriggers,
  markTriggerFired,
  recordFiring,
  setTriggerEnabled,
  type CreateTriggerInput,
  type Trigger,
  type TriggerFiring,
} from '../state/triggers.ts';
import { tierAtLeast } from '../policy/lattice.ts';
import type { WorkflowRegistry } from '../registry/workflow-registry.ts';
import { inputProblems, type SourceAvailability } from '../registry/resolver.ts';
import { listSources } from '../state/sources.ts';
import { isValidTimezone, nextCronAfter, parseCron } from './cron.ts';
import type { WorkflowService } from './service.ts';

export interface TriggerServiceDeps {
  readonly store: StateStore;
  readonly workflows: WorkflowRegistry;
  readonly workflowService: WorkflowService;
  /** The declared sources a trigger's input may name; the store's active sources when absent. */
  readonly sources?: () => readonly SourceAvailability[];
  readonly now: () => string;
  readonly nextId: (prefix: string) => string;
  /** The absolute project root a recipe should cd into. */
  readonly projectRoot: string;
}

export interface DefineTriggerInput extends Omit<CreateTriggerInput, 'id' | 'at' | 'nextDueAt'> {
  readonly id?: string;
}

export interface FireInput {
  readonly triggerId: string;
  /** The clock's own key for this tick; defaults to the trigger id plus the minute. */
  readonly firingKey?: string;
  readonly eventPayload?: Readonly<Record<string, unknown>>;
  readonly dryRun?: boolean;
}

export interface FireResult {
  readonly firing: TriggerFiring | null;
  readonly outcome: TriggerFiring['outcome'] | 'dry_run';
  readonly runId: string | null;
  readonly reason: string;
  readonly nextDueAt: string | null;
}

export interface TriggerService {
  define(input: DefineTriggerInput): Trigger;
  list(): Trigger[];
  get(id: string): Trigger | null;
  enable(id: string, enabled: boolean): Trigger;
  /** Triggers whose next due instant is at or before `at`. */
  due(at: string): Trigger[];
  fire(input: FireInput): FireResult;
  recipe(id: string, clock: 'cron' | 'github-actions'): string;
  nextDue(id: string, after: string): string | null;
}

export function createTriggerService(deps: TriggerServiceDeps): TriggerService {
  const { store } = deps;

  const sourceIds = (): string[] => (deps.sources ? deps.sources().map((x) => x.id) : listSources(store, { status: 'active' }).map((x) => x.id));

  function nextDue(trigger: Trigger, after: string): string | null {
    if (trigger.kind !== 'schedule' || !trigger.scheduleExpression || !trigger.timezone) return null;
    return nextCronAfter(trigger.scheduleExpression, trigger.timezone, after);
  }

  return {
    define(input) {
      const workflow = deps.workflows.get(input.workflowId);
      if (!workflow) throw new Error(`no workflow ${input.workflowId}`);
      if (!workflow.manifest.triggers.includes(input.kind)) throw new Error(`${input.workflowId} does not accept ${input.kind} triggers (it accepts ${workflow.manifest.triggers.join(', ')})`);
      if (input.kind === 'schedule') {
        parseCron(input.scheduleExpression ?? '');
        if (!isValidTimezone(input.timezone ?? '')) throw new Error(`"${input.timezone ?? ''}" is not a timezone this runtime knows`);
      }
      const highest = workflow.manifest.steps.reduce((acc, s) => (tierAtLeast(s.tier, acc) ? s.tier : acc), 'observe' as Trigger['maxTier']);
      if (!tierAtLeast(input.maxTier, highest)) {
        throw new Error(`${input.workflowId} has a step at ${highest}; the trigger's permission boundary (${input.maxTier}) is below it`);
      }
      const at = deps.now();
      const given = (input.input ?? {}) as Record<string, unknown>;
      // An event carries inputs of its own, so only an event trigger may leave a required input to its payload.
      const problems = inputProblems(workflow.manifest, given, { at, sourceIds: sourceIds(), timezone: input.timezone ?? 'UTC' })
        .filter((p) => input.kind !== 'event' || p.code !== 'missing_step_input');
      if (problems[0]) throw new Error(`${problems[0].message}. ${problems[0].remedy}`);
      if (input.kind !== 'manual') {
        for (const [key, type] of Object.entries(workflow.manifest.inputSchema)) {
          if (type !== 'period' || given[key] === undefined) continue;
          const p = given[key] as Record<string, unknown>;
          const fixed = p.relative === undefined && (p.from !== undefined || p.to !== undefined || p.year !== undefined);
          if (fixed && p.semantics !== 'as_of') throw new Error(`input "${key}" names a fixed window, and a standing trigger fires again and again; give the period as relative (for example last_week) so each firing covers its own window`);
          if (p.relative !== undefined && (p.from !== undefined || p.to !== undefined)) throw new Error(`input "${key}" gives dates beside ${String(p.relative)}, and a standing trigger fires again and again; give the relative period alone so each firing works out its own dates`);
        }
      }
      const id = input.id ?? deps.nextId('trigger');
      const created = createTrigger(store, { ...input, id, at });
      const due = nextDue(created, at);
      return due ? markTriggerFired(store, id, created.createdAt, due) : created;
    },
    list: () => listTriggers(store),
    get: (id) => getTrigger(store, id),
    enable: (id, enabled) => setTriggerEnabled(store, id, enabled, deps.now()),
    due(at) {
      return listTriggers(store, { enabled: true }).filter((t) => t.kind === 'schedule' && t.nextDueAt !== null && t.nextDueAt <= at);
    },
    nextDue(id, after) {
      const t = getTrigger(store, id);
      if (!t) throw new Error(`no trigger ${id}`);
      return nextDue(t, after);
    },
    fire({ triggerId, firingKey, eventPayload, dryRun }) {
      const at = deps.now();
      const trigger = getTrigger(store, triggerId);
      if (!trigger) throw new Error(`no trigger ${triggerId}`);
      const key = firingKey ?? `${triggerId}:${at.slice(0, 16)}`;
      const due = nextDue(trigger, at);
      const input = { ...((trigger.input ?? {}) as Record<string, unknown>), ...(eventPayload ?? {}) };
      // A firing covers the window of the tick that was due, even when the clock arrives late.
      const dueAt = trigger.nextDueAt !== null && trigger.nextDueAt <= at ? trigger.nextDueAt : at;
      const clock = { periodAt: dueAt, timezone: trigger.timezone ?? 'UTC' };
      if (dryRun) {
        const { preflight } = deps.workflowService.preflight(trigger.workflowId, input, clock);
        return { firing: null, outcome: 'dry_run', runId: null, reason: preflight.summary, nextDueAt: due };
      }
      return store.transaction(() => {
        if (!trigger.enabled) {
          const { firing } = recordFiring(store, { id: deps.nextId('firing'), triggerId, idempotencyKey: key, at, outcome: 'disabled', reason: 'trigger is disabled' });
          return { firing, outcome: 'disabled', runId: null, reason: 'trigger is disabled', nextDueAt: due };
        }
        const already = recordFiring(store, { id: deps.nextId('firing'), triggerId, idempotencyKey: key, at, outcome: 'deduplicated', reason: 'placeholder' });
        if (!already.created) {
          return { firing: already.firing, outcome: 'deduplicated', runId: already.firing.runId, reason: `firing ${key} was already handled (${already.firing.outcome})`, nextDueAt: due };
        }
        // The placeholder row is replaced below with the real outcome.
        const finish = (outcome: TriggerFiring['outcome'], runId: string | null, reason: string): FireResult => {
          store.db.prepare('UPDATE trigger_firings SET outcome = ?, run_id = ?, reason = ? WHERE id = ?').run(outcome, runId, reason, already.firing.id);
          markTriggerFired(store, triggerId, at, due);
          return { firing: { ...already.firing, outcome, runId, reason }, outcome, runId, reason, nextDueAt: due };
        };
        const active = listActiveRuns(store).find((r) => r.workflowId === trigger.workflowId && r.state !== 'blocked');
        if (active && trigger.overlap === 'skip') return finish('skipped_overlap', active.id, `run ${active.id} is still active; overlap policy is skip`);
        if (active && trigger.overlap === 'replace') {
          deps.workflowService.cancel({ runId: active.id, by: `trigger:${triggerId}`, reason: 'replaced by a newer firing' });
        }
        const started = deps.workflowService.start({ workflowId: trigger.workflowId, input, trigger: trigger.kind === 'event' ? 'event' : 'schedule', idempotencyKey: `${trigger.workflowId}:firing:${key}`, executorKind: 'headless', ...clock, firing: { triggerId, dueAt } });
        if (started.run.state === 'blocked') return finish('blocked', started.run.id, started.preflight.summary);
        return finish(active && trigger.overlap === 'replace' ? 'replaced' : 'started', started.run.id, started.preflight.summary);
      });
    },
    recipe(id, clock) {
      const t = getTrigger(store, id);
      if (!t) throw new Error(`no trigger ${id}`);
      if (clock === 'cron') {
        const expr = t.kind === 'schedule' ? t.scheduleExpression! : '# fire on your event instead of a schedule';
        return [
          `# Construct trigger ${t.id} for workflow ${t.workflowId} (${t.timezone ?? 'local time'})`,
          `# Construct keeps the run ledger, lock, retries, evidence, and deliverable; cron only supplies the tick.`,
          `${expr} cd ${JSON.stringify(deps.projectRoot)} && construct workflow fire ${t.id} --key "$(date -u +%Y-%m-%dT%H:%M)"`,
          '',
        ].join('\n');
      }
      return [
        `name: construct ${t.id}`,
        'on:',
        ...(t.kind === 'schedule' ? ['  schedule:', `    - cron: ${JSON.stringify(t.scheduleExpression)}  # ${t.timezone}; GitHub schedules run in UTC, so convert or accept the offset`] : ['  workflow_dispatch: {}']),
        'jobs:',
        '  fire:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '      - uses: actions/setup-node@v4',
        "        with: { node-version: '22' }",
        '      - run: npm ci',
        `      - run: npx construct workflow fire ${t.id} --key "$GITHUB_RUN_ID"`,
        '',
      ].join('\n');
    },
  };
}
