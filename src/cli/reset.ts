/**
 * cli/reset.ts — remove exactly the Construct-owned files a person confirms,
 * then recreate clean state. Without --confirm it only names the targets.
 */

import { existsSync } from 'node:fs';
import { planReset, applyReset } from '../kernel/project/reset.ts';
import { initializeProject, readProjectFiles } from '../kernel/project/initialize.ts';
import { projectLayout } from '../kernel/project/layout.ts';
import { findProjectRoot } from '../kernel/project/discover.ts';
import { boolFlag, type CommandSpec, type ParsedArgs } from './commands.ts';
import { createContext, gitRootOf, initRootFor, type CliContext } from './context.ts';
import { esc, say, writeJson } from './output.ts';
import { basename } from 'node:path';

export const RESET_SPEC: CommandSpec = {
  path: ['reset'],
  gloss: 'name the Construct-owned files that would be removed; with --confirm, remove exactly them and start clean',
  group: 'Recover',
  positionals: [],
  flags: [
    { name: 'confirm', gloss: 'remove the named targets', takesValue: false },
    { name: 'include-project-files', gloss: 'also remove the committed .construct files, not only runtime state', takesValue: false },
    { name: 'keep-state', gloss: 'do not recreate state after removing', takesValue: false },
  ],
  readOnly: false,
};

export function reset(args: ParsedArgs, ctx: CliContext = createContext()): number {
  const floor = gitRootOf(ctx.cwd) ?? ctx.cwd;
  const root = findProjectRoot({ start: ctx.cwd, floor }) ?? initRootFor(ctx.cwd);
  const plan = planReset(root, { includeProjectFiles: boolFlag(args, 'include-project-files'), paths: ctx.paths });

  if (!boolFlag(args, 'confirm')) {
    if (args.json) {
      writeJson({ root, targets: plan.targets, removed: [] });
      return 0;
    }
    if (plan.targets.length === 0) {
      say(`Nothing to reset under ${esc(root)}: no Construct state or earlier-alpha files found.`);
      return 0;
    }
    say(`construct reset would remove exactly these (${esc(root)}):`);
    for (const t of plan.targets) say(`  ${esc(t.path)}  (${esc(t.what)})`);
    say('Nothing was removed. Re-run with --confirm to remove them and start clean.');
    return 0;
  }

  const removed = plan.targets.length === 0 ? [] : applyReset(plan, plan.targets.map((t) => t.path));
  let recreated: string | null = null;
  if (!boolFlag(args, 'keep-state')) {
    const existing = readProjectFiles(root).config;
    const at = ctx.now();
    const result = initializeProject({ root, projectId: existing?.id ?? ctx.nextId('proj'), name: existing?.name ?? basename(root), at });
    result.store.close();
    recreated = result.layout.dbPath;
  }
  if (args.json) {
    writeJson({ root, targets: plan.targets, removed, recreated });
    return 0;
  }
  say(removed.length === 0 ? 'Nothing needed removing.' : `Removed ${String(removed.length)} path(s):`);
  for (const p of removed) say(`  ${esc(p)}`);
  if (recreated) say(`Fresh state at ${esc(recreated)}${existsSync(projectLayout(root).projectFile) ? '' : ' with new project files'}.`);
  return 0;
}
