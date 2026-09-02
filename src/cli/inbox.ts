/**
 * cli/inbox.ts — the decisions waiting on the person, and resolving one.
 */

import { getDecision, listOpenDecisions } from '../kernel/state/decisions.ts';
import { type CommandSpec, type ParsedArgs } from './commands.ts';
import { createContext, type CliContext } from './context.ts';
import { openBroker } from './broker-context.ts';
import { esc, say, writeJson, UsageError, OperationError } from './output.ts';

const group = 'Runs';

export const INBOX_SPECS: readonly CommandSpec[] = [
  { path: ['inbox', 'list'], gloss: 'decisions, approvals, and questions waiting on you', group, positionals: [], flags: [], readOnly: true },
  { path: ['inbox', 'show'], gloss: 'one decision with everything behind it', group, positionals: ['<id>'], flags: [], readOnly: true },
  { path: ['inbox', 'resolve'], gloss: 'answer a decision; an approval covers exactly the action asked about', group, positionals: ['<id>', '<answer>'], flags: [], readOnly: false },
];

export async function inboxCommand(sub: string, args: ParsedArgs, ctx: CliContext = createContext()): Promise<number> {
  const { project, broker } = openBroker(ctx, {});
  try {
    switch (sub) {
      case 'list': {
        const rows = listOpenDecisions(project.store);
        if (args.json) writeJson(rows);
        else if (rows.length === 0) say('nothing waits on you');
        else for (const d of rows) say(`${esc(d.id)}  ${d.kind}  ${esc(d.question)}${d.options ? `  [${d.options.join(' | ')}]` : ''}${d.runId ? `  run ${esc(d.runId)}` : ''}`);
        return 0;
      }
      case 'show': {
        const d = getDecision(project.store, args.positionals[0]!);
        if (!d) throw new OperationError(`no decision ${args.positionals[0]!}`);
        if (args.json) writeJson(d);
        else {
          say(`${esc(d.id)} (${d.kind}, ${d.state}): ${esc(d.question)}`);
          if (d.options) say(`  options: ${d.options.join(' | ')}`);
          if (d.subject) say(`  about: ${esc(JSON.stringify(d.subject))}`);
          if (d.resolution !== null) say(`  answered by ${esc(d.resolvedBy ?? '?')}: ${esc(JSON.stringify(d.resolution))}`);
        }
        return 0;
      }
      case 'resolve': {
        const [id, answer] = args.positionals as [string, string];
        const r = broker.workflow.decide({ decisionId: id, resolution: answer, by: 'person via cli' });
        if (args.json) writeJson(r);
        else say(`recorded: ${esc(id)} → ${esc(answer)}${r.run ? `; run ${esc(r.run.id)} is ${r.run.state}` : ''}`);
        return 0;
      }
      default:
        throw new UsageError(`inbox has no subcommand "${sub}"`);
    }
  } finally {
    project.store.close();
  }
}
