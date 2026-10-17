import { askedOf } from './asked.ts';
/**
 * kernel/workflow/triggers.ts — standing outcomes: define a trigger, let a
 * clock fire it, keep the ledger, and write the recipe the clock needs.
 * Construct owns what happens on a firing; the platform owns time. The one
 * clock Construct writes is a per-user launchd or systemd timer, and only the
 * explicit `workflow install-timer` command writes it (timer-unit.ts).
 *
 * A trigger's input is checked when it is defined. A period in it is kept
 * relative and worked out at each firing's due time in the trigger's own
 * timezone, so every firing covers its own window.
 */

import type { Intake } from './intake.ts';
import type { AskedReading } from './asked.ts';
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
import { timerUnit, type TimerFacts, type TimerPlatform, type TimerUnitFile } from './timer-unit.ts';

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

export type TriggerClock = 'cron' | 'github-actions' | TimerPlatform;

export interface TriggerService {
  define(input: DefineTriggerInput): Trigger;
  list(): Trigger[];
  get(id: string): Trigger | null;
  enable(id: string, enabled: boolean): Trigger;
  /** Triggers whose next due instant is at or before `at`. */
  due(at: string): Trigger[];
  fire(input: FireInput): FireResult;
  /** The text a clock needs to fire a trigger; a platform timer's text is exactly what `timer` installs. */
  recipe(id: string, clock: TriggerClock, executor?: string, facts?: TimerFacts): string;
  /** The files of the platform timer that fires a schedule trigger. Refuses without an executor. */
  timer(id: string, platform: TimerPlatform, executor: string | undefined, facts: TimerFacts): TimerUnitFile[];
  nextDue(id: string, after: string): string | null;
}

/** Marks the record of a slot passed over while disabled; no clock-supplied key may end in it. */
const DISABLED_SUFFIX = '~disabled';

export function createTriggerService(deps: TriggerServiceDeps): TriggerService {
  const { store } = deps;

  const sourceIds = (): string[] =>
    deps.sources ? deps.sources().map((x) => x.id) : listSources(store, { status: 'active' }).map((x) => x.id);

  function nextDue(trigger: Trigger, after: string): string | null {
    if (trigger.kind !== 'schedule' || !trigger.scheduleExpression || !trigger.timezone) return null;
    return nextCronAfter(trigger.scheduleExpression, trigger.timezone, after);
  }

  /**
   * The key a clock-less firing of a schedule trigger takes: the slot that was
   * due, never the wall clock. A platform timer that fires late, or coalesces
   * the slots missed while the machine slept into one start, names the slot it
   * covers; a repeat after that slot was handled names it again and is
   * deduplicated. Null for a trigger that has no slot to name.
   */
  function slotKey(trigger: Trigger, slotDue: boolean): string | null {
    if (trigger.kind !== 'schedule') return null;
    const prefix = `${trigger.id}@`;
    if (slotDue) return `${prefix}${trigger.nextDueAt!}`;
    // The last slot a firing handled; a slot passed over while disabled was never handled.
    const row = store.db
      // length() in SQLite, which counts characters where JavaScript counts UTF-16 units.
      .prepare(
        "SELECT idempotency_key AS k FROM trigger_firings WHERE trigger_id = ? AND substr(idempotency_key, 1, length(?)) = ? AND outcome <> 'disabled' ORDER BY fired_at DESC, id DESC LIMIT 1",
      )
      .get(trigger.id, prefix, prefix) as { k: string } | undefined;
    return row?.k ?? null;
  }

  return {
    define(input) {
      const workflow = deps.workflows.get(input.workflowId);
      if (!workflow) throw new Error(`no workflow ${input.workflowId}`);
      if (!workflow.manifest.triggers.includes(input.kind))
        throw new Error(`${input.workflowId} does not accept ${input.kind} triggers (it accepts ${workflow.manifest.triggers.join(', ')})`);
      if (input.kind === 'schedule') {
        parseCron(input.scheduleExpression ?? '');
        if (!isValidTimezone(input.timezone ?? '')) throw new Error(`"${input.timezone ?? ''}" is not a timezone this runtime knows`);
      }
      const highest = workflow.manifest.steps.reduce(
        (acc, s) => (tierAtLeast(s.tier, acc) ? s.tier : acc),
        'observe' as Trigger['maxTier'],
      );
      if (!tierAtLeast(input.maxTier, highest)) {
        throw new Error(`${input.workflowId} has a step at ${highest}; the trigger's permission boundary (${input.maxTier}) is below it`);
      }
      const at = deps.now();
      const given = (input.input ?? {}) as Record<string, unknown>;
      // An event carries inputs of its own, so only an event trigger may leave a required input to its payload.
      const problems = inputProblems(workflow.manifest, given, { at, sourceIds: sourceIds(), timezone: input.timezone ?? 'UTC' }).filter(
        (p) => input.kind !== 'event' || p.code !== 'missing_step_input',
      );
      if (problems[0]) throw new Error(`${problems[0].message}. ${problems[0].remedy}`);
      if (input.kind !== 'manual') {
        for (const [key, type] of Object.entries(workflow.manifest.inputSchema)) {
          if (type !== 'period' || given[key] === undefined) continue;
          const p = given[key] as Record<string, unknown>;
          const fixed = p.relative === undefined && (p.from !== undefined || p.to !== undefined || p.year !== undefined);
          if (fixed && p.semantics !== 'as_of')
            throw new Error(
              `input "${key}" names a fixed window, and a standing trigger fires again and again; give the period as relative (for example last_week) so each firing covers its own window`,
            );
          if (p.relative !== undefined && (p.from !== undefined || p.to !== undefined))
            throw new Error(
              `input "${key}" gives dates beside ${String(p.relative)}, and a standing trigger fires again and again; give the relative period alone so each firing works out its own dates`,
            );
        }
      }
      const id = input.id ?? deps.nextId('trigger');
      const created = createTrigger(store, { ...input, id, at });
      const due = nextDue(created, at);
      return due ? markTriggerFired(store, id, created.createdAt, due) : created;
    },
    list: () => listTriggers(store),
    get: (id) => getTrigger(store, id),
    enable(id, enabled) {
      const at = deps.now();
      return store.transaction(() => {
        const wasEnabled = getTrigger(store, id)?.enabled ?? false;
        const t = setTriggerEnabled(store, id, enabled, at);
        // Only turning a disabled trigger on skips ahead; enabling one already on keeps its pending slot.
        if (!enabled || wasEnabled) return t;
        // Slots that fell due while disabled are not owed: the next one is the first after now.
        const due = nextDue(t, at);
        if (due === t.nextDueAt) return t;
        store.db.prepare('UPDATE triggers SET next_due_at = ?, updated_at = ? WHERE id = ?').run(due, at, id);
        return getTrigger(store, id)!;
      });
    },
    due(at) {
      return listTriggers(store, { enabled: true }).filter((t) => t.kind === 'schedule' && t.nextDueAt !== null && t.nextDueAt <= at);
    },
    nextDue(id, after) {
      const t = getTrigger(store, id);
      if (!t) throw new Error(`no trigger ${id}`);
      return nextDue(t, after);
    },
    fire({ triggerId, firingKey, eventPayload, dryRun }) {
      if (firingKey !== undefined && firingKey.endsWith(DISABLED_SUFFIX))
        throw new Error(
          `a firing key may not end in ${DISABLED_SUFFIX}; that suffix marks a slot passed over while the trigger was disabled`,
        );
      const at = deps.now();
      // Everything the firing decides from the trigger is read inside the write
      // transaction (BEGIN IMMEDIATE), so a concurrent enable or firing cannot
      // be overwritten by a decision made from a stale read.
      const resolveFiring = () => {
        const trigger = getTrigger(store, triggerId);
        if (!trigger) throw new Error(`no trigger ${triggerId}`);
        const slotDue = trigger.nextDueAt !== null && trigger.nextDueAt <= at;
        const key = firingKey ?? slotKey(trigger, slotDue) ?? `${triggerId}:${at.slice(0, 16)}`;
        const due = nextDue(trigger, at);
        const input = { ...((trigger.input ?? {}) as Record<string, unknown>), ...(eventPayload ?? {}) };
        // A firing covers the window of the tick that was due, even when the clock arrives late.
        const dueAt = slotDue ? trigger.nextDueAt! : at;
        return { trigger, slotDue, key, due, input, dueAt, clock: { periodAt: dueAt, timezone: trigger.timezone ?? 'UTC' } };
      };
      if (dryRun) {
        const { trigger, input, clock, due } = resolveFiring();
        const { preflight } = deps.workflowService.preflight(trigger.workflowId, input, clock);
        return { firing: null, outcome: 'dry_run', runId: null, reason: preflight.summary, nextDueAt: due };
      }
      return store.transaction(() => {
        const { trigger, slotDue, key, due, input, dueAt, clock } = resolveFiring();
        if (!trigger.enabled) {
          // Recorded under its own key, so passing a slot over never consumes the key an enabled firing will use.
          const { firing } = recordFiring(store, {
            id: deps.nextId('firing'),
            triggerId,
            idempotencyKey: `${key}${DISABLED_SUFFIX}`,
            at,
            outcome: 'disabled',
            reason: 'trigger is disabled',
          });
          // A disabled trigger still moves past the slot, so the slot's key never stands in for a later one.
          if (slotDue) store.db.prepare('UPDATE triggers SET next_due_at = ?, updated_at = ? WHERE id = ?').run(due, at, triggerId);
          return { firing, outcome: 'disabled', runId: null, reason: 'trigger is disabled', nextDueAt: due };
        }
        const already = recordFiring(store, {
          id: deps.nextId('firing'),
          triggerId,
          idempotencyKey: key,
          at,
          outcome: 'deduplicated',
          reason: 'placeholder',
        });
        if (!already.created) {
          return {
            firing: already.firing,
            outcome: 'deduplicated',
            runId: already.firing.runId,
            reason: `firing ${key} was already handled (${already.firing.outcome})`,
            nextDueAt: due,
          };
        }
        // The placeholder row is replaced below with the real outcome.
        const finish = (outcome: TriggerFiring['outcome'], runId: string | null, reason: string): FireResult => {
          store.db
            .prepare('UPDATE trigger_firings SET outcome = ?, run_id = ?, reason = ? WHERE id = ?')
            .run(outcome, runId, reason, already.firing.id);
          markTriggerFired(store, triggerId, at, due);
          return { firing: { ...already.firing, outcome, runId, reason }, outcome, runId, reason, nextDueAt: due };
        };
        const current = deps.workflows.get(trigger.workflowId);
        const exceeds = current?.manifest.steps.find((step) => !tierAtLeast(trigger.maxTier, step.tier));
        if (exceeds)
          return finish(
            'blocked',
            null,
            `workflow step ${exceeds.id} now requires ${exceeds.tier}, above this trigger's frozen ${trigger.maxTier} boundary; review the definition before firing again`,
          );
        const fixed = (trigger.input ?? {}) as Record<string, unknown>;
        const changedInputs = Object.keys(eventPayload ?? {}).filter(
          (key) => key in fixed && JSON.stringify(eventPayload![key]) !== JSON.stringify(fixed[key]),
        );
        if (changedInputs.length)
          return finish(
            'blocked',
            null,
            `event payload attempted to replace frozen trigger input: ${changedInputs.join(', ')}; event data cannot redefine the standing intent`,
          );
        const ownedActive = listActiveRuns(store).filter((r) => askedOf(r).firing?.triggerId === triggerId && r.state !== 'blocked');
        const active = ownedActive[0];
        if (active && trigger.overlap === 'skip')
          return finish('skipped_overlap', active.id, `run ${active.id} is still active; overlap policy is skip`);
        if (active && trigger.overlap === 'replace') {
          for (const old of ownedActive)
            deps.workflowService.cancel({ runId: old.id, by: `trigger:${triggerId}`, reason: 'replaced by a newer firing' });
        }
        const intake = (trigger.delivery as { intake?: Intake } | null)?.intake;
        const asked: AskedReading | undefined = intake
          ? {
              intake,
              periodSpec: intake.period,
              declared: { words: intake.words, stakes: intake.stakes, chosenSkill: intake.skill },
              judgedBy: { by: 'trigger_definition', host: null, client: null },
              sources: {
                registered: intake.sources.filter((s) => s.role === 'read' && s.id).map((s) => s.id!),
                named: intake.sources.map((s) => ({ name: s.name, id: s.id, registered: !!s.id && sourceIds().includes(s.id) })),
              },
            }
          : undefined;
        const started = deps.workflowService.start({
          asked,
          workflowId: trigger.workflowId,
          input,
          trigger: trigger.kind === 'event' ? 'event' : 'schedule',
          idempotencyKey: JSON.stringify([trigger.workflowId, triggerId, key]),
          executorKind: 'headless',
          ...clock,
          firing: { triggerId, dueAt },
        });
        if (started.run.state === 'blocked') return finish('blocked', started.run.id, started.preflight.summary);
        return finish(active && trigger.overlap === 'replace' ? 'replaced' : 'started', started.run.id, started.preflight.summary);
      });
    },
    timer(id, platform, executor, facts) {
      const t = getTrigger(store, id);
      if (!t) throw new Error(`no trigger ${id}`);
      if (!executor)
        throw new Error(
          'a platform timer needs an explicit executor: without one a firing only records a tick and no model work happens. Inspect construct workflow executors, then pass --executor=<id>',
        );
      if (t.kind !== 'schedule' || !t.scheduleExpression || !t.timezone)
        throw new Error(`trigger ${id} is an ${t.kind} trigger; a platform timer fires only a schedule`);
      return timerUnit(platform, {
        triggerId: t.id,
        expression: t.scheduleExpression,
        timezone: t.timezone,
        executor,
        projectRoot: deps.projectRoot,
        facts,
      });
    },
    recipe(id, clock, executor, facts) {
      const t = getTrigger(store, id);
      if (!t) throw new Error(`no trigger ${id}`);
      if (clock === 'launchd' || clock === 'systemd') {
        if (!facts) throw new Error(`a ${clock} recipe needs this machine's facts`);
        if (!executor)
          return '# Unprovisioned: no unattended executor selected. A timer would only create a run.\n# Inspect construct workflow executors, then request this recipe with --executor=<id>.\n';
        return this.timer(id, clock, executor, facts)
          .map((f) => `# ${f.name}\n${f.content}`)
          .join('\n');
      }
      if (!executor)
        return '# Unprovisioned: no unattended executor selected. A clock only creates a run.\n# Inspect construct workflow executors, then request this recipe with --executor=<id>.\n';
      if (!/^[a-z][a-z0-9-]*$/.test(executor)) throw new Error('executor must be an adapter id, not a shell command');
      const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
      const command = `cd ${quote(deps.projectRoot)} && npx --no-install construct workflow fire ${quote(t.id)} --execute=${quote(executor)}`;
      if (clock === 'cron') {
        if (t.kind !== 'schedule') return '# An event trigger needs an event sender, not a cron expression.\n';
        return [
          `# Construct keeps the run ledger; provision Node, npm, authenticated ${executor}, and this persistent project first.`,
          '# Requires a cron implementation supporting CRON_TZ. You install this line; `construct workflow install-timer` installs a launchd or systemd timer instead.',
          '# The line passes no firing key: each firing names the schedule slot that was due, so a late or repeated tick covers that slot once.',
          `CRON_TZ=${t.timezone}`,
          `${t.scheduleExpression} ${command}`,
          '',
        ].join('\n');
      }
      // A fresh checkout has no ignored trigger database. CI must target the
      // existing owned state, never pretend checkout + npm ci reconstructs it.
      return [
        `name: construct ${JSON.stringify(t.id)}`,
        'on:',
        ...(t.kind === 'schedule'
          ? ['  schedule:', `    - cron: ${JSON.stringify(t.scheduleExpression)}`, `      timezone: ${JSON.stringify(t.timezone)}`]
          : ['  workflow_dispatch: {}']),
        '# Requires an explicitly provisioned self-hosted runner with this persistent project and authenticated host.',
        '# Do not run untrusted pull-request code in this runner. No checkout or state restoration is implied.',
        'jobs:',
        '  fire:',
        '    runs-on: [self-hosted, construct]',
        '    steps:',
        '      - name: Execute the existing local trigger',
        '        shell: bash',
        '        run: |',
        `          ${command} --key "$GITHUB_RUN_ID"`,
        '',
      ].join('\n');
    },
  };
}
