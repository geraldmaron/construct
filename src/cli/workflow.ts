/**
 * cli/workflow.ts — the workflows a project can run: list, show, resolve, run
 * (or preview), validate the bundles, and the standing triggers that fire
 * them from an external clock.
 */

import { listTriggers } from '../kernel/state/triggers.ts';
import { OVERLAP_POLICIES, TRIGGER_ADAPTERS } from '../kernel/state/triggers.ts';
import { ACTION_TIERS, type ActionTier } from '../kernel/state/steps.ts';
import { boolFlag, stringFlag, type CommandSpec, type ParsedArgs } from './commands.ts';
import { createContext, type CliContext } from './context.ts';
import { openBroker } from './broker-context.ts';
import { esc, say, writeJson, UsageError, OperationError } from './output.ts';

const group = 'Workflows';

export const WORKFLOW_SPECS: readonly CommandSpec[] = [
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
  { path: ['workflow', 'fire'], gloss: 'fire a trigger now, as an external clock would', group, positionals: ['<trigger-id>'], flags: [{ name: 'key', gloss: 'the clock’s key for this tick (same key, same run)', takesValue: true }, { name: 'dry-run', gloss: 'preflight only', takesValue: false }], readOnly: false },
  { path: ['workflow', 'recipe'], gloss: 'print the cron line or CI job that fires a trigger', group, positionals: ['<trigger-id>'], flags: [{ name: 'clock', gloss: 'cron or github-actions (default cron)', takesValue: true }], readOnly: true },
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

export async function workflowCommand(sub: string, args: ParsedArgs, ctx: CliContext = createContext()): Promise<number> {
  const { project, broker } = openBroker(ctx, {});
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
        if (args.json) writeJson({ run: started.run, created: started.created, preflight: started.preflight });
        else {
          say(`${started.created ? 'started' : 'already running'}: run ${started.run.id} (${started.run.state})`);
          if (started.run.state === 'blocked') for (const r of started.preflight.reasons) say(`  ${r.code}: ${esc(r.message)}. ${esc(r.remedy)}`);
          say(started.run.state === 'blocked' ? 'Next: clear the reasons above, then `construct run resume ' + started.run.id + '`.' : 'Next: the steps run in your agent session; `construct run show ' + started.run.id + '` follows along.');
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
          say(`Next: \`construct workflow recipe ${esc(t.id)}\` prints the cron line or CI job that fires it. Construct keeps the ledger; the clock only ticks.`);
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
        const result = broker.triggers.fire({ triggerId: args.positionals[0]!, firingKey: stringFlag(args, 'key'), dryRun: boolFlag(args, 'dry-run') });
        if (args.json) writeJson(result);
        else say(`${result.outcome}${result.runId ? ` run ${result.runId}` : ''}: ${esc(result.reason)}${result.nextDueAt ? `; next due ${result.nextDueAt}` : ''}`);
        return result.outcome === 'blocked' ? 1 : 0;
      }
      case 'recipe': {
        const clock = stringFlag(args, 'clock') ?? 'cron';
        if (clock !== 'cron' && clock !== 'github-actions') throw new UsageError('--clock must be cron or github-actions');
        process.stdout.write(broker.triggers.recipe(args.positionals[0]!, clock));
        return 0;
      }
      default:
        throw new UsageError(`workflow has no subcommand "${sub}"`);
    }
  } finally {
    project.store.close();
  }
}
