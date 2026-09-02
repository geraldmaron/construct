/**
 * cli/run.ts — runs: list, show, cancel, resume.
 */

import { listRuns, RUN_STATES, type RunState } from '../kernel/state/runs.ts';
import { stringFlag, type CommandSpec, type ParsedArgs } from './commands.ts';
import { createContext, type CliContext } from './context.ts';
import { openBroker } from './broker-context.ts';
import { esc, say, writeJson, UsageError, OperationError } from './output.ts';

const group = 'Runs';

export const RUN_SPECS: readonly CommandSpec[] = [
  { path: ['run', 'list'], gloss: 'recent runs and their states', group, positionals: [], flags: [{ name: 'state', gloss: `only this state: ${RUN_STATES.join(' | ')}`, takesValue: true }], readOnly: true },
  { path: ['run', 'show'], gloss: 'one run: steps, deliverables and their trust, open decisions', group, positionals: ['<id>'], flags: [], readOnly: true },
  { path: ['run', 'cancel'], gloss: 'cancel a run; a leased step may finish first if the workflow says so', group, positionals: ['<id>'], flags: [{ name: 'reason', gloss: 'why', takesValue: true }], readOnly: false },
  { path: ['run', 'resume'], gloss: 'resume a run after an interruption; finished work is not repeated', group, positionals: ['<id>'], flags: [], readOnly: false },
];

export async function runCommand(sub: string, args: ParsedArgs, ctx: CliContext = createContext()): Promise<number> {
  const { project, broker } = openBroker(ctx, {});
  try {
    switch (sub) {
      case 'list': {
        const state = stringFlag(args, 'state');
        if (state !== undefined && !(RUN_STATES as readonly string[]).includes(state)) throw new UsageError(`--state must be one of ${RUN_STATES.join(' | ')}`);
        const rows = listRuns(project.store, { state: state as RunState | undefined, limit: 100 });
        if (args.json) writeJson(rows);
        else if (rows.length === 0) say('no runs yet');
        else for (const r of rows) say(`${esc(r.id)}  ${esc(r.workflowId)}@${r.workflowVersion}  ${r.state}  ${r.triggerKind}  ${r.createdAt}${r.stateReason ? `  ${esc(r.stateReason)}` : ''}`);
        return 0;
      }
      case 'show': {
        const v = broker.workflow.status(args.positionals[0]!);
        if (!v) throw new OperationError(`no run ${args.positionals[0]!}`, '`construct run list` shows the ones that exist.');
        if (args.json) {
          writeJson(v);
          return 0;
        }
        say(`run ${esc(v.run.id)}: ${esc(v.run.workflowId)} ${v.run.workflowVersion}, ${v.run.state}${v.run.stateReason ? ` (${esc(v.run.stateReason)})` : ''}`);
        say(`  started ${v.run.createdAt} by ${esc(v.run.executorId)} (${v.run.triggerKind})`);
        for (const s of v.steps) say(`  step ${esc(s.stepId)}: ${s.state}${s.attempts ? ` after ${String(s.attempts)} attempt(s)` : ''}${s.stateReason ? ` (${esc(s.stateReason)})` : ''}`);
        for (const d of v.deliverables) say(`  deliverable ${esc(d.id)}: ${d.kind}, ${d.trustState}`);
        for (const d of v.openDecisions) say(`  waiting on you: ${esc(d.question)}${d.options ? ` [${d.options.join(' | ')}]` : ''} (decision ${esc(d.id)})`);
        return 0;
      }
      case 'cancel': {
        const run = broker.workflow.cancel({ runId: args.positionals[0]!, by: 'cli', reason: stringFlag(args, 'reason') ?? 'cancelled from the command line' });
        if (args.json) writeJson(run);
        else say(run.state === 'cancelled' ? `run ${esc(run.id)} cancelled` : `run ${esc(run.id)} will stop after the step in progress`);
        return 0;
      }
      case 'resume': {
        const run = broker.workflow.resume(args.positionals[0]!);
        if (args.json) writeJson(run);
        else say(`run ${esc(run.id)} is ${run.state}${run.stateReason ? ` (${esc(run.stateReason)})` : ''}`);
        return run.state === 'blocked' ? 1 : 0;
      }
      default:
        throw new UsageError(`run has no subcommand "${sub}"`);
    }
  } finally {
    project.store.close();
  }
}
