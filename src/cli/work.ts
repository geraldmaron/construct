/**
 * cli/work.ts — native work ledger: query, ready, claim, complete, reopen,
 * export, restore, and one-way import of a frozen legacy tracker snapshot.
 */

import {
  cancelWork,
  claimWork,
  completeWork,
  createWork,
  exportWork,
  getWork,
  getWorkByLegacyId,
  listReady,
  queryWork,
  readinessOf,
  releaseWork,
  reopenWork,
  restoreWork,
  type WorkKind,
  type WorkStatus,
} from '../kernel/work/service.ts';
import { importLegacySnapshot } from '../kernel/work/legacy-import.ts';
import { boolFlag, type CommandSpec, type ParsedArgs } from './commands.ts';
import { createContext, type CliContext } from './context.ts';
import { withProject } from './context.ts';
import { esc, say, writeJson, UsageError, OperationError } from './output.ts';
import { readFileSync, writeFileSync } from 'node:fs';

const group = 'Work';

export const WORK_SPECS: readonly CommandSpec[] = [
  { path: ['work', 'list'], gloss: 'query work items', group, positionals: [], flags: [
    { name: 'status', gloss: 'filter by status', takesValue: true },
    { name: 'kind', gloss: 'filter by kind', takesValue: true },
    { name: 'query', gloss: 'filter by text or id', takesValue: true },
    { name: 'limit', gloss: 'page size (default 50)', takesValue: true },
  ], readOnly: true },
  { path: ['work', 'show'], gloss: 'one work item, including legacy-id lookup', group, positionals: ['<id>'], flags: [], readOnly: true },
  { path: ['work', 'ready'], gloss: 'work that can be claimed now', group, positionals: [], flags: [], readOnly: true },
  { path: ['work', 'add'], gloss: 'create a work item', group, positionals: ['<title>'], flags: [
    { name: 'kind', gloss: 'outcome, task, defect, or plan (default task)', takesValue: true },
    { name: 'description', gloss: 'body of the item', takesValue: true },
  ], readOnly: false },
  { path: ['work', 'claim'], gloss: 'claim a ready item for this session', group, positionals: ['<id>'], flags: [
    { name: 'until', gloss: 'ISO timestamp when the claim expires', takesValue: true },
    { name: 'revision', gloss: 'expected revision', takesValue: true },
  ], readOnly: false },
  { path: ['work', 'release'], gloss: 'release a claim', group, positionals: ['<id>', '<token>'], flags: [], readOnly: false },
  { path: ['work', 'complete'], gloss: 'complete claimed or owned work', group, positionals: ['<id>'], flags: [
    { name: 'reason', gloss: 'why it is complete', takesValue: true },
    { name: 'token', gloss: 'claim token if held', takesValue: true },
  ], readOnly: false },
  { path: ['work', 'reopen'], gloss: 'reopen completed or cancelled work with a reason', group, positionals: ['<id>'], flags: [
    { name: 'reason', gloss: 'why it is open again', takesValue: true },
  ], readOnly: false },
  { path: ['work', 'cancel'], gloss: 'cancel work with a reason', group, positionals: ['<id>'], flags: [
    { name: 'reason', gloss: 'why it is cancelled', takesValue: true },
  ], readOnly: false },
  { path: ['work', 'export'], gloss: 'write a versioned snapshot of work (not live state)', group, positionals: ['<file>'], flags: [], readOnly: true },
  { path: ['work', 'restore'], gloss: 'restore a snapshot; never restores grants or live leases', group, positionals: ['<file>'], flags: [], readOnly: false },
  { path: ['work', 'import-legacy'], gloss: 'one-way import of a frozen tracker JSONL snapshot', group, positionals: ['<file>'], flags: [
    { name: 'dry-run', gloss: 'report mapping without writing', takesValue: false },
  ], readOnly: false },
];

export async function workCommand(sub: string, args: ParsedArgs, ctx: CliContext = createContext()): Promise<number> {
  const at = ctx.now();
  const actor = 'person via cli';
  return withProject(ctx, (project) => {
    switch (sub) {
      case 'list': {
        const page = queryWork(project.store, {
          status: args.flags.status as WorkStatus | undefined,
          kind: args.flags.kind as WorkKind | undefined,
          query: args.flags.query as string | undefined,
          limit: args.flags.limit ? Number(args.flags.limit) : 50,
        });
        if (args.json) writeJson(page);
        else if (page.items.length === 0) say('no work matches');
        else {
          for (const w of page.items) say(`${esc(w.id)}  ${w.status}  ${w.kind}  ${esc(w.title)}`);
          if (page.truncated) say(`… ${String(page.total - page.items.length)} more (pass --limit and a query)`);
        }
        return 0;
      }
      case 'show': {
        const id = args.positionals[0]!;
        const w = getWork(project.store, id) ?? getWorkByLegacyId(project.store, id);
        if (!w) throw new OperationError(`no work ${id}`);
        const ready = readinessOf(project.store, w, at);
        if (args.json) writeJson({ ...w, readiness: ready });
        else {
          say(`${esc(w.id)}  ${w.status}  ${w.kind}  rev ${String(w.revision)}`);
          say(esc(w.title));
          if (w.description) say(esc(w.description));
          if (!ready.ready) say(`not ready: ${ready.blockers.map(esc).join('; ')}`);
        }
        return 0;
      }
      case 'ready': {
        const items = listReady(project.store, at);
        if (args.json) writeJson(items);
        else if (items.length === 0) say('nothing is ready');
        else for (const w of items) say(`${esc(w.id)}  ${w.kind}  ${esc(w.title)}`);
        return 0;
      }
      case 'add': {
        const title = args.positionals[0]!;
        const w = createWork(project.store, {
          id: ctx.nextId('work'),
          kind: (args.flags.kind as WorkKind | undefined) ?? 'task',
          title,
          description: (args.flags.description as string | undefined) ?? title,
          at,
          actor,
        });
        if (args.json) writeJson(w);
        else say(`created ${esc(w.id)}  ${w.status}  ${esc(w.title)}`);
        return 0;
      }
      case 'claim': {
        const w = claimWork(project.store, {
          id: args.positionals[0]!,
          owner: actor,
          until: (args.flags.until as string | undefined) ?? new Date(Date.parse(at) + 30 * 60_000).toISOString(),
          now: at,
          expectedRevision: args.flags.revision ? Number(args.flags.revision) : undefined,
        });
        if (args.json) writeJson(w);
        else say(`claimed ${esc(w.id)} until ${w.claimUntil} token ${esc(w.claimToken ?? '')}`);
        return 0;
      }
      case 'release': {
        const w = releaseWork(project.store, { id: args.positionals[0]!, owner: actor, token: args.positionals[1]!, at });
        if (args.json) writeJson(w);
        else say(`released ${esc(w.id)}`);
        return 0;
      }
      case 'complete': {
        const w = completeWork(project.store, {
          id: args.positionals[0]!,
          owner: actor,
          token: args.flags.token as string | undefined,
          at,
          reason: args.flags.reason as string | undefined,
        });
        if (args.json) writeJson(w);
        else say(`completed ${esc(w.id)}`);
        return 0;
      }
      case 'reopen': {
        const reason = args.flags.reason as string | undefined;
        if (!reason) throw new UsageError('work reopen needs --reason');
        const w = reopenWork(project.store, { id: args.positionals[0]!, actor, at, reason });
        if (args.json) writeJson(w);
        else say(`reopened ${esc(w.id)}`);
        return 0;
      }
      case 'cancel': {
        const reason = args.flags.reason as string | undefined;
        if (!reason) throw new UsageError('work cancel needs --reason');
        const w = cancelWork(project.store, { id: args.positionals[0]!, actor, at, reason });
        if (args.json) writeJson(w);
        else say(`cancelled ${esc(w.id)}`);
        return 0;
      }
      case 'export': {
        const dump = exportWork(project.store, at, project.files.config?.id ?? null);
        writeFileSync(args.positionals[0]!, `${JSON.stringify(dump, null, 2)}\n`);
        if (args.json) writeJson({ file: args.positionals[0], count: dump.work.length });
        else say(`wrote ${String(dump.work.length)} work item(s) to ${esc(args.positionals[0]!)}`);
        return 0;
      }
      case 'restore': {
        const dump = JSON.parse(readFileSync(args.positionals[0]!, 'utf8')) as ReturnType<typeof exportWork>;
        const report = restoreWork(project.store, dump, at);
        if (args.json) writeJson(report);
        else say(`restored ${String(report.imported)}, skipped ${String(report.skipped)}, conflicts ${String(report.conflicts.length)}`);
        return 0;
      }
      case 'import-legacy': {
        const report = importLegacySnapshot(project.store, {
          jsonl: readFileSync(args.positionals[0]!, 'utf8'),
          at,
          dryRun: boolFlag(args, 'dry-run'),
          nextId: ctx.nextId,
        });
        if (args.json) writeJson(report);
        else {
          say(`legacy import: ${String(report.imported)} imported, ${String(report.skipped)} skipped, ${String(report.malformed.length)} malformed`);
          for (const m of report.malformed.slice(0, 20)) say(`  malformed: ${esc(m)}`);
        }
        return 0;
      }
      default:
        throw new UsageError(`work has no subcommand "${sub}"`);
    }
  });
}
