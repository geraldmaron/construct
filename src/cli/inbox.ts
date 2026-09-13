/**
 * cli/inbox.ts — the items waiting on the person, and resolving one.
 */

import { getDecision } from '../kernel/state/decisions.ts';
import { getStatement } from '../kernel/state/profile.ts';
import { listInbox, resolveProposal } from '../kernel/project/onboarding.ts';
import { type CommandSpec, type ParsedArgs } from './commands.ts';
import { createContext, type CliContext } from './context.ts';
import { openBroker } from './broker-context.ts';
import { esc, say, writeJson, UsageError, OperationError } from './output.ts';

const group = 'Runs';

export const INBOX_SPECS: readonly CommandSpec[] = [
  { path: ['inbox', 'list'], gloss: 'approvals, questions, and proposed statements waiting on you', group, positionals: [], flags: [], readOnly: true },
  { path: ['inbox', 'show'], gloss: 'one inbox item with everything behind it', group, positionals: ['<id>'], flags: [], readOnly: true },
  { path: ['inbox', 'resolve'], gloss: 'answer a decision or confirm or retire a proposal', group, positionals: ['<id>', '<answer>'], flags: [], readOnly: false },
];

export async function inboxCommand(sub: string, args: ParsedArgs, ctx: CliContext = createContext()): Promise<number> {
  const { project, broker } = openBroker(ctx, {});
  try {
    switch (sub) {
      case 'list': {
        const rows = listInbox(project.store);
        if (args.json) writeJson(rows);
        else if (rows.length === 0) say('nothing waits on you');
        else for (const d of rows) {
          if (d.kind === 'proposal') say(`${esc(d.id)}  proposal  ${esc(d.text)}  [${d.options.join(' | ')}]`);
          else say(`${esc(d.id)}  ${d.decisionKind}  ${esc(d.question)}${d.options ? `  [${d.options.join(' | ')}]` : ''}${d.run ? `  run ${esc(d.run)}` : ''}`);
        }
        return 0;
      }
      case 'show': {
        const id = args.positionals[0]!;
        const d = getDecision(project.store, id);
        const proposal = d ? null : getStatement(project.store, id);
        if (!d && !proposal) throw new OperationError(`no inbox item ${id}`);
        if (args.json) writeJson(d ?? proposal);
        else if (d) {
          say(`${esc(d.id)} (${d.kind}, ${d.state}): ${esc(d.question)}`);
          if (d.options) say(`  options: ${d.options.join(' | ')}`);
          if (d.subject) say(`  about: ${esc(JSON.stringify(d.subject))}`);
          if (d.resolution !== null) say(`  answered by ${esc(d.resolvedBy ?? '?')}: ${esc(JSON.stringify(d.resolution))}`);
        } else if (proposal) {
          say(`${esc(proposal.id)} (proposal, ${proposal.status}): ${esc(proposal.text)}`);
          say('  options: confirm | retire');
        }
        return 0;
      }
      case 'resolve': {
        const [id, answer] = args.positionals as [string, string];
        const proposal = getStatement(project.store, id);
        if (proposal?.status === 'proposed') {
          const s = resolveProposal(project.store, { id, resolution: answer, at: broker.now(), nextId: broker.nextId });
          if (args.json) writeJson(s);
          else say(`recorded: ${esc(id)} → ${esc(answer)} (${s.kind} is ${s.status})`);
          return 0;
        }
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
