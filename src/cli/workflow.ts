/**
 * cli/workflow.ts — the workflows a project can run: list, show, resolve, run
 * (or preview), validate the bundles, and the standing triggers that fire
 * them from a clock: a cron line or CI job the person installs, or the
 * per-user platform timer `install-timer` installs and `remove-timer` removes.
 */

import { randomUUID } from 'node:crypto';
import { prepareExecutor, executeRun, executorSupport } from '../hosts/executors.ts';
import { appendActivity } from '../kernel/state/activity.ts';
import { expireDeadLeases } from '../kernel/state/steps.ts';
import { listTriggers } from '../kernel/state/triggers.ts';
import { OVERLAP_POLICIES, TRIGGER_ADAPTERS } from '../kernel/state/triggers.ts';
import { ACTION_TIERS, type ActionTier } from '../kernel/state/steps.ts';
import { boolFlag, stringFlag, type CommandSpec, type ParsedArgs } from './commands.ts';
import { createContext, resolveRepository, type CliContext } from './context.ts';
import { openBroker } from './broker-context.ts';
import { esc, say, writeJson, UsageError, OperationError } from './output.ts';
import { runExecutionProblems } from '../kernel/workflow/verification.ts';
import { projectResolver } from '../kernel/source/resolver.ts';
import { differsFlag } from '../kernel/workflow/service.ts';
import { transitionRun } from '../kernel/state/runs.ts';
import { timerLabel, type TimerFacts } from '../kernel/workflow/timer-unit.ts';
import { installTimer, uninstallTimer } from '../hosts/timer.ts';
import { describeTimer, timerFacts, timerRows, timerSetup, type TimerSetup } from './timers.ts';
import { dirname, join } from 'node:path';

const group = 'Workflows';

export const WORKFLOW_SPECS: readonly CommandSpec[] = [
  { path: ['workflow', 'executors'], gloss: 'which hosts have an unattended adapter and which require provisioning', group, positionals: [], flags: [], readOnly: true },
  { path: ['workflow', 'list'], gloss: 'the workflows this project can run, with versions and what starts them', group, positionals: [], flags: [], readOnly: true },
  { path: ['workflow', 'show'], gloss: 'one workflow: purpose, steps, tiers, inputs, policies', group, positionals: ['<id>'], flags: [], readOnly: true },
  { path: ['workflow', 'resolve'], gloss: 'can this workflow run here now, and what would stop it', group, positionals: ['<id>'], flags: [{ name: 'input', gloss: 'a key=value input (repeatable)', takesValue: true, repeatable: true }], readOnly: true },
  { path: ['workflow', 'run'], gloss: 'start a run of a workflow from the command line (the host does the steps)', group, positionals: ['<id>'], flags: [{ name: 'input', gloss: 'a key=value input (repeatable)', takesValue: true, repeatable: true }, { name: 'dry-run', gloss: 'resolve and report; start nothing', takesValue: false }], readOnly: false },
  { path: ['workflow', 'validate'], gloss: 'check every skill and workflow bundle this project can see', group, positionals: [], flags: [], readOnly: true },
  {
    path: ['workflow', 'schedule'],
    gloss: 'define a standing trigger for a workflow, fired by cron or CI',
    group,
    positionals: ['<id>'],
    flags: [
      { name: 'cron', gloss: 'five-field cron expression', takesValue: true },
      { name: 'timezone', gloss: 'IANA timezone for the expression (default UTC)', takesValue: true },
      { name: 'event', gloss: 'an event name instead of a schedule', takesValue: true },
      { name: 'adapter', gloss: `who fires it: ${TRIGGER_ADAPTERS.join(' | ')} (default cron)`, takesValue: true },
      { name: 'overlap', gloss: `${OVERLAP_POLICIES.join(' | ')} when a run is still active (default skip)`, takesValue: true },
      { name: 'max-tier', gloss: `the highest tier a firing may act at: ${ACTION_TIERS.filter((t) => t !== 'licensed_judgment').join(' | ')}`, takesValue: true },
      { name: 'input', gloss: 'a key=value input (repeatable)', takesValue: true, repeatable: true },
      { name: 'trigger-id', gloss: 'a stable id for the trigger', takesValue: true },
    ],
    readOnly: false,
  },
  { path: ['workflow', 'triggers'], gloss: 'the standing triggers defined here, with next due and last fired', group, positionals: [], flags: [], readOnly: true },
  { path: ['workflow', 'enable'], gloss: 'enable a standing trigger', group, positionals: ['<trigger-id>'], flags: [], readOnly: false },
  { path: ['workflow', 'disable'], gloss: 'disable a standing trigger; nothing fires until enabled', group, positionals: ['<trigger-id>'], flags: [], readOnly: false },
  { path: ['workflow', 'fire'], gloss: 'fire a trigger now, as an external clock would', group, positionals: ['<trigger-id>'], flags: [{ name: 'key', gloss: 'the clock’s key for this tick (same key, same run)', takesValue: true }, { name: 'dry-run', gloss: 'preflight only', takesValue: false }, { name: 'execute', gloss: 'explicit unattended host adapter (codex); otherwise only record the tick', takesValue: true }, { name: 'timeout-ms', gloss: 'bounded executor timeout (default 900000)', takesValue: true }], readOnly: false },
  { path: ['workflow', 'recipe'], gloss: 'print the cron line, CI job, or platform timer that fires a trigger', group, positionals: ['<trigger-id>'], flags: [{ name: 'clock', gloss: 'cron, github-actions, launchd, or systemd (default cron)', takesValue: true }, { name: 'executor', gloss: 'explicit host adapter for the recipe; without one it remains unprovisioned', takesValue: true }], readOnly: true },
  { path: ['workflow', 'install-timer'], gloss: 'install the per-user launchd or systemd timer that fires a schedule trigger; reinstalling replaces it', group, positionals: ['<trigger-id>'], flags: [{ name: 'executor', gloss: 'the unattended host adapter each firing hands the run to (required; workflow executors lists them)', takesValue: true }], readOnly: false },
  { path: ['workflow', 'remove-timer'], gloss: 'unload and remove the platform timer for a trigger, or for a unit label doctor named', group, positionals: ['<trigger-id-or-label>'], flags: [], readOnly: false },
  { path: ['workflow', 'timers'], gloss: 'the platform timers on this machine that fire Construct triggers, and any that would fire into nothing', group, positionals: [], flags: [], readOnly: true },
];

function inputsFrom(args: ParsedArgs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const raw = args.flags.input;
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  for (const item of list) {
    const eq = item.indexOf('=');
    if (eq <= 0) throw new UsageError(`--input takes key=value, not "${item}"`);
    const key = item.slice(0, eq);
    const value = item.slice(eq + 1);
    out[key] = value.startsWith('[') || value.startsWith('{') ? (JSON.parse(value) as unknown) : value;
  }
  return out;
}

function requireTimerSetup(ctx: CliContext): TimerSetup {
  const setup = timerSetup(ctx);
  if (!setup) throw new OperationError('this platform has no per-user scheduler Construct writes to', 'Use `construct workflow recipe <trigger-id> --clock=cron` and install the line yourself.');
  return setup;
}

function removeByLabel(ctx: CliContext, label: string, json: boolean | undefined): number {
  const setup = requireTimerSetup(ctx);
  if (!/^construct\.[A-Za-z0-9][A-Za-z0-9_-]*\.[A-Za-z0-9][A-Za-z0-9_-]*$/.test(label)) throw new UsageError(`${label} is not a Construct timer label`);
  const { removed } = uninstallTimer(setup.target, label, setup.control);
  if (json) writeJson({ label, removed });
  else say(removed.length ? `removed ${esc(label)}: ${removed.map(esc).join(', ')}` : `no timer ${esc(label)} is installed`);
  return 0;
}

export async function workflowCommand(sub: string, args: ParsedArgs, ctx: CliContext = createContext()): Promise<number> {
  if (sub === 'executors') { writeJson(executorSupport()); return 0; }
  if (sub === 'remove-timer' && args.positionals[0]?.startsWith('construct.')) return removeByLabel(ctx, args.positionals[0], args.json);
  const execute = sub === 'fire' ? stringFlag(args, 'execute') : undefined;
  if (execute && execute !== 'codex') throw new UsageError('no unattended adapter for this executor; workflow executors shows support');
  // An executor that cannot run here does not stop the firing: the tick is
  // recorded and its run is blocked with the reason, so a timer that fires
  // after a host login expired leaves a run that says so instead of nothing.
  let prepared: Awaited<ReturnType<typeof prepareExecutor>> | null = null;
  let unprovisioned: string | null = null;
  if (execute && !boolFlag(args, 'dry-run')) {
    try {
      prepared = await prepareExecutor(execute, ctx.env);
    } catch (error) {
      unprovisioned = (error as Error).message;
    }
  }
  const executorId = execute ? `runner:${execute}:${randomUUID()}` : undefined;
  const { project, broker } = openBroker(ctx, sub === 'fire' ? { headless: true, executor: executorId, client: execute } : {});
  try {
    switch (sub) {
      case 'list': {
        const rows = broker.workflows.list().map((w) => ({ id: w.manifest.id, version: w.manifest.version, origin: w.origin, class: w.manifest.interactionClass, triggers: w.manifest.triggers, title: w.manifest.title }));
        if (args.json) writeJson(rows);
        else if (rows.length === 0) say('no workflows are available; the package ships none and .construct/workflows is empty');
        else for (const r of rows) say(`${r.id}  ${r.version}  ${r.origin}  ${r.class}  ${r.triggers.join('/')}  ${esc(r.title)}`);
        return 0;
      }
      case 'show': {
        const w = broker.workflows.get(args.positionals[0]!);
        if (!w) throw new OperationError(`no workflow ${args.positionals[0]!}`, '`construct workflow list` shows the ones available.');
        if (args.json) {
          writeJson({ ...w.manifest, origin: w.origin, digest: w.digest });
          return 0;
        }
        const m = w.manifest;
        say(`${m.id} ${m.version} (${w.origin}): ${esc(m.title)}`);
        say(`  ${esc(m.purpose)}`);
        say(`  class: ${m.interactionClass}; triggers: ${m.triggers.join(', ')}; concurrency: ${m.concurrency}; no data: ${m.onNoData}; stale data: ${m.onStaleData}`);
        say(`  inputs: ${Object.entries(m.inputSchema).map(([k, t]) => `${k}: ${t}${m.requiredInputs.includes(k) ? ' (required)' : ''}`).join(', ') || 'none'}`);
        say('  steps:');
        for (const s of m.steps) say(`    ${s.id}  ${s.tier}  ${s.skill ? `${s.skill.id} ${s.skill.range}` : '-'}  needs ${s.needs.join(',') || '-'}  ${esc(s.title)}`);
        say(`  deliverable: ${m.deliverable.kind}${m.deliverable.challenge ? ' (challenged before acceptance)' : ''}`);
        return 0;
      }
      case 'resolve':
      case 'run': {
        const id = args.positionals[0]!;
        const input = inputsFrom(args);
        if (sub === 'resolve' || boolFlag(args, 'dry-run')) {
          const { preflight } = broker.workflow.preflight(id, input);
          if (args.json) writeJson(preflight);
          else {
            say(`${esc(preflight.summary)}`);
            for (const r of preflight.reasons) say(`  ${r.code}${r.stepId ? ` at ${r.stepId}` : ''}: ${esc(r.message)}. ${esc(r.remedy)}`);
            for (const f of preflight.flags) say(`  note: ${esc(f)}`);
            if (sub === 'run') say('Nothing was started (dry run).');
          }
          return preflight.status === 'runnable' || preflight.status === 'outdated' ? 0 : 1;
        }
        const started = broker.workflow.start({ workflowId: id, input, trigger: 'manual' });
        if (args.json) writeJson({ run: started.run, created: started.created, preflight: started.preflight, differs: started.differs, superseded: started.superseded });
        else {
          say(`${started.created ? 'started' : started.run.state === 'blocked' ? 'checked again' : 'already running'}: run ${started.run.id} (${started.run.state})`);
          if (started.superseded) say(`superseded blocked run ${started.superseded}`);
          if (started.differs.length > 0) say(`note: ${esc(differsFlag(started.run.id, started.differs))}`);
          if (started.run.state === 'blocked') for (const r of started.preflight.reasons) say(`  ${r.code}: ${esc(r.message)}. ${esc(r.remedy)}`);
          say(started.run.state === 'blocked' ? 'Next: clear the reasons above, then `construct run resume ' + started.run.id + '`, or run this again with the input corrected; it says when it replaces this run.' : 'Next: the steps run in your agent session; `construct run show ' + started.run.id + '` follows along.');
        }
        return started.run.state === 'blocked' ? 1 : 0;
      }
      case 'validate': {
        const problems = [...broker.skills.problems(), ...broker.workflows.problems()];
        const portable = broker.skills.portableOnly();
        if (args.json) writeJson({ ok: problems.length === 0, problems, portableOnly: portable });
        else {
          for (const p of problems) say(`problem: ${esc(p.dir)}: ${esc(p.message)}`);
          for (const p of portable) say(`note: ${esc(p.dir)} carries no Construct manifest; it is usable by a host but no workflow can bind it`);
          say(problems.length === 0 ? `${String(broker.skills.list().length)} skill(s) and ${String(broker.workflows.list().length)} workflow(s) validate` : `${String(problems.length)} bundle(s) failed`);
        }
        return problems.length === 0 ? 0 : 1;
      }
      case 'schedule': {
        const id = args.positionals[0]!;
        const cron = stringFlag(args, 'cron');
        const event = stringFlag(args, 'event');
        if (!cron && !event) throw new UsageError('give --cron=<expression> or --event=<name>');
        const adapter = stringFlag(args, 'adapter') ?? 'cron';
        if (!(TRIGGER_ADAPTERS as readonly string[]).includes(adapter)) throw new UsageError(`--adapter must be one of ${TRIGGER_ADAPTERS.join(' | ')}`);
        const overlap = stringFlag(args, 'overlap') ?? 'skip';
        if (!(OVERLAP_POLICIES as readonly string[]).includes(overlap)) throw new UsageError(`--overlap must be one of ${OVERLAP_POLICIES.join(' | ')}`);
        const maxTier = stringFlag(args, 'max-tier') ?? 'draft';
        if (!(ACTION_TIERS as readonly string[]).includes(maxTier)) throw new UsageError(`--max-tier must be one of ${ACTION_TIERS.join(' | ')}`);
        const t = broker.triggers.define({ id: stringFlag(args, 'trigger-id'), workflowId: id, kind: cron ? 'schedule' : 'event', scheduleExpression: cron, timezone: cron ? (stringFlag(args, 'timezone') ?? 'UTC') : undefined, eventName: event, adapter: adapter as 'cron', overlap: overlap as 'skip', maxTier: maxTier as ActionTier, delivery: { destination: 'inbox' }, input: inputsFrom(args) });
        if (args.json) writeJson(t);
        else {
          say(`defined trigger ${esc(t.id)} for ${esc(t.workflowId)}${t.nextDueAt ? `; next due ${t.nextDueAt}` : ''}`);
          say(`Next: \`construct workflow install-timer ${esc(t.id)} --executor=<id>\` installs a per-user timer that fires it, or \`construct workflow recipe ${esc(t.id)}\` prints a cron line or CI job. Construct keeps the ledger; the clock only ticks.`);
        }
        return 0;
      }
      case 'triggers': {
        const rows = listTriggers(project.store);
        if (args.json) writeJson(rows);
        else if (rows.length === 0) say('no standing triggers; `construct workflow schedule <id> --cron=...` defines one');
        else for (const t of rows) say(`${esc(t.id)}  ${esc(t.workflowId)}  ${t.kind}  ${t.enabled ? 'enabled' : 'disabled'}  ${t.scheduleExpression ? `${esc(t.scheduleExpression)} ${esc(t.timezone ?? '')}` : esc(t.eventName ?? '')}  next ${t.nextDueAt ?? '-'}  last ${t.lastFiredAt ?? '-'}`);
        return 0;
      }
      case 'enable':
      case 'disable': {
        const t = broker.triggers.enable(args.positionals[0]!, sub === 'enable');
        if (args.json) writeJson(t);
        else say(`${esc(t.id)} is ${t.enabled ? 'enabled' : 'disabled'}`);
        return 0;
      }
      case 'fire': {
        let result = broker.triggers.fire({ triggerId: args.positionals[0]!, firingKey: stringFlag(args, 'key'), dryRun: boolFlag(args, 'dry-run') });
        if (unprovisioned && result.runId && ['started', 'replaced', 'deduplicated'].includes(result.outcome)) {
          const run = broker.workflow.status(result.runId)!.run;
          if (!['succeeded', 'failed', 'cancelled', 'waiting_for_decision', 'blocked'].includes(run.state)) {
            transitionRun(project.store, { id: run.id, to: 'blocked', at: ctx.now(), reason: unprovisioned, actor: executorId });
          }
          result = { ...result, reason: unprovisioned };
        }
        let execution: unknown = null;
        if (prepared && result.runId && ['started', 'replaced', 'deduplicated'].includes(result.outcome)) {
          const prior = broker.workflow.status(result.runId)!;
          if (!['succeeded', 'failed', 'cancelled', 'waiting_for_decision'].includes(prior.run.state)) {
            if (prior.run.state === 'blocked') broker.workflow.resume(prior.run.id);
            appendActivity(project.store, { at: ctx.now(), kind: 'executor.started', runId: result.runId, actor: executorId, payload: { adapter: prepared.id, version: prepared.version, timeoutMs: Number(stringFlag(args, 'timeout-ms') ?? 900000) } });
            execution = await executeRun({ binary: prepared.binary, root: project.root, runId: result.runId, executorId: executorId!, env: ctx.env, timeoutMs: Number(stringFlag(args, 'timeout-ms') ?? 900000) });
            // This adapter owns this process group and has stopped it. Fence only its
            // abandoned leases, so an interrupted run can resume without a 30-minute wait.
            project.store.db.prepare("UPDATE step_runs SET lease_until = ? WHERE lease_owner = ? AND state = 'leased'").run(ctx.now(), executorId!);
            expireDeadLeases(project.store, ctx.now(), result.runId);
            appendActivity(project.store, { at: ctx.now(), kind: 'executor.finished', runId: result.runId, actor: executorId, payload: execution });
          }
        }
        const state = result.runId ? broker.workflow.status(result.runId)?.run.state : null;
        const verificationProblems = state === 'succeeded' && result.runId ? runExecutionProblems(project.store, result.runId, projectResolver(project.store, project.root)) : [];
        const complete = state === 'succeeded' && verificationProblems.length === 0;
        const disabled = result.outcome === 'disabled';
        const response = { ...result, execution, runState: state, complete, verificationProblems, next: disabled ? `The trigger is off, so the slot was recorded and passed over; \`construct workflow enable ${args.positionals[0]!}\` turns it back on.` : complete ? 'Review the local deliverable and its assurance.' : execute ? 'Inspect run show; resolve its blocker or retry this same firing key. No executor fallback occurred.' : 'A tick alone performs no model work. Provision an explicit executor and a persistent project state, then use --execute or claim the run in a session.' };
        if (args.json) writeJson(response);
        else say(`${response.outcome}${response.runId ? ` run ${response.runId} (${state})` : ''}: ${esc(response.reason)}. ${response.next}`);
        // A disabled trigger is the person's choice, not a failure of the clock that fired it.
        if (disabled) return 0;
        return result.outcome === 'blocked' || verificationProblems.length > 0 || (execute && !complete) ? 1 : 0;
      }
      case 'install-timer': {
        const setup = requireTimerSetup(ctx);
        const executor = stringFlag(args, 'executor');
        if (!executor) throw new UsageError('install-timer needs --executor=<id>: without one a firing only records a tick and no model work happens; `construct workflow executors` lists them');
        if (!executorSupport().some((e) => e.host === executor && e.supported)) throw new UsageError(`no unattended adapter for ${executor}; \`construct workflow executors\` shows support`);
        const projectId = project.files.config?.id;
        if (!projectId) throw new OperationError('this project has no identity to name a timer by', 'Run `construct init` first.');
        const id = args.positionals[0]!;
        setup.control.admit(setup.target);
        // A unit outlives the checkout it was installed from; a linked worktree is the checkout most likely to go.
        const launcherRepo = resolveRepository(dirname(setup.launcher));
        if (launcherRepo?.linked) throw new OperationError(`this Construct runs from the git worktree ${launcherRepo.checkout}, and a timer installed from it stops working when that worktree is removed`, 'Install the timer from the main checkout or from an installed construct.');
        const files = broker.triggers.timer(id, setup.target.platform, executor, timerFacts(ctx, setup, projectId, executor));
        const label = timerLabel(projectId, id);
        const installed = installTimer(setup.target, label, files, setup.control, join(ctx.paths.stateDir, 'timers'));
        const trigger = broker.triggers.get(id)!;
        if (args.json) writeJson({ label, platform: setup.target.platform, files: installed.files, replaced: installed.replaced, nextDueAt: trigger.nextDueAt });
        else {
          say(`${installed.replaced ? 'replaced' : 'installed'} ${esc(label)} (${setup.target.platform}): ${installed.files.map(esc).join(', ')}`);
          say(`It fires \`construct workflow fire ${esc(id)} --execute=${esc(executor)}\` at ${esc(trigger.scheduleExpression ?? '')} ${esc(trigger.timezone ?? '')}${trigger.nextDueAt ? `; next due ${trigger.nextDueAt}` : ''}, then exits. A missed slot fires once on wake.`);
          say(`Next: \`construct workflow timers\` lists it; \`construct workflow remove-timer ${esc(id)}\` removes it.`);
        }
        return 0;
      }
      case 'remove-timer': {
        const projectId = project.files.config?.id;
        if (!projectId) throw new OperationError('this project has no identity to name a timer by', 'Give the unit label `construct workflow timers` shows.');
        return removeByLabel(ctx, timerLabel(projectId, args.positionals[0]!), args.json);
      }
      case 'timers': {
        const rows = timerRows(ctx, { id: project.files.config?.id ?? null, root: project.root, store: project.store });
        if (args.json) writeJson(rows);
        else if (rows.length === 0) say('no platform timers fire Construct triggers on this machine; `construct workflow install-timer <trigger-id> --executor=<id>` installs one');
        else for (const t of rows) say(`${t.here ? 'here' : 'other'}  ${esc(describeTimer(t))}`);
        return rows.some((t) => t.here && t.problem) ? 1 : 0;
      }
      case 'recipe': {
        const clock = stringFlag(args, 'clock') ?? 'cron';
        if (clock !== 'cron' && clock !== 'github-actions' && clock !== 'launchd' && clock !== 'systemd') throw new UsageError('--clock must be cron, github-actions, launchd, or systemd');
        const executor = stringFlag(args, 'executor');
        let facts: TimerFacts | undefined;
        if (clock === 'launchd' || clock === 'systemd') {
          const setup = requireTimerSetup(ctx);
          const projectId = project.files.config?.id;
          if (!projectId) throw new OperationError('this project has no identity to name a timer by', 'Run `construct init` first.');
          facts = timerFacts(ctx, setup, projectId, executor ?? 'codex');
        }
        process.stdout.write(broker.triggers.recipe(args.positionals[0]!, clock, executor, facts));
        return 0;
      }
      default:
        throw new UsageError(`workflow has no subcommand "${sub}"`);
    }
  } finally {
    project.store.close();
  }
}
