/**
 * cli/project.ts — show, validate, and refresh the project's own description.
 * Refresh re-reads the project's files and proposes; it confirms nothing.
 */

import { gatherProjectMaterial } from '../hosts/repo/material.ts';
import { draftFromMaterial } from '../kernel/project/discovery.ts';
import { applyDiscoveryDraft, composeConstitution, onboardingStatus } from '../kernel/project/onboarding.ts';
import { constitutionCompleteness, saveConstitution, emptyConstitution } from '../kernel/project/constitution.ts';
import { readProjectFiles } from '../kernel/project/initialize.ts';
import { readProjectFileBytes } from '../kernel/project/files.ts';
import { projectLayout } from '../kernel/project/layout.ts';
import { listStatements } from '../kernel/state/profile.ts';
import type { CommandSpec, ParsedArgs } from './commands.ts';
import { createContext, locateProject, withProject, type CliContext } from './context.ts';
import { esc, say, writeJson, UsageError } from './output.ts';
import { basename } from 'node:path';

const group = 'Inspect';

export const PROJECT_SPECS: readonly CommandSpec[] = [
  { path: ['project', 'show'], gloss: 'the project’s identity, constitution, and what is still unanswered', group, positionals: [], flags: [], readOnly: true },
  { path: ['project', 'validate'], gloss: 'check every committed .construct file', group, positionals: [], flags: [], readOnly: true },
  { path: ['project', 'refresh'], gloss: 're-read the project’s own files and propose updates; confirms nothing', group: 'Setup', positionals: [], flags: [], readOnly: false },
];

/**
 * The committed .construct files whose bytes differ between the main
 * checkout's project and a worktree's copy of it. A file that cannot be read
 * on either side counts as different.
 */
function differingInWorktree(root: string, laneRoot: string): string[] {
  const read = (dir: string, file: string): string | null => {
    try {
      return readProjectFileBytes(dir, file)?.toString('base64') ?? null;
    } catch (error) {
      return `unreadable: ${(error as Error).message}`;
    }
  };
  const main = projectLayout(root);
  const lane = projectLayout(laneRoot);
  const pairs = [
    [main.projectFile, lane.projectFile],
    [main.constitutionFile, lane.constitutionFile],
    [main.sourcesFile, lane.sourcesFile],
    [main.lockFile, lane.lockFile],
  ] as const;
  return pairs.filter(([m, l]) => read(root, m) !== read(laneRoot, l)).map(([m]) => basename(m));
}

export function projectCommand(sub: string, args: ParsedArgs, ctx: CliContext = createContext()): number {
  switch (sub) {
    case 'show':
      return withProject(ctx, ({ root, files, store }) => {
        const c = files.constitution;
        const completeness = c ? constitutionCompleteness(c) : { complete: false, missing: ['constitution file'] };
        const proposed = listStatements(store, { status: 'proposed' });
        const record = { root, config: files.config, constitution: c, completeness, proposedStatements: proposed.length, onboarding: onboardingStatus(store).state };
        if (args.json) {
          writeJson(record);
          return 0;
        }
        say(`${esc(files.config?.name ?? 'project')} (${esc(files.config?.id ?? 'no id')}) at ${esc(root)}`);
        say(`  purpose: ${c?.purpose ? esc(c.purpose) : 'not yet stated'}`);
        say(`  scale: ${c?.scale ?? 'not yet answered'}; primary outcome: ${c?.primaryOutcome ? esc(c.primaryOutcome) : 'not yet answered'}`);
        say(`  principles: ${String(c?.principles.length ?? 0)}; constraints: ${String(c?.constraints.length ?? 0)}; success measures: ${String(c?.successMeasures.length ?? 0)}; glossary: ${String(c?.glossary.length ?? 0)}`);
        say(`  canonical artifacts: ${c && c.canonicalArtifacts.length ? c.canonicalArtifacts.map((a) => `${esc(a.path)} (${esc(a.role)})`).join(', ') : 'none confirmed'}`);
        say(`  unknowns: ${c && c.unknowns.length ? c.unknowns.map(esc).join('; ') : 'none declared'}`);
        say(`  ${completeness.complete ? 'complete' : `incomplete: ${completeness.missing.join(', ')}`}; ${String(proposed.length)} proposal(s) awaiting review`);
        return 0;
      });
    case 'validate': {
      // The configuration every other command binds to: the main checkout's, even from a worktree.
      const { root, lane } = locateProject(ctx);
      const problems: string[] = [];
      try {
        const files = readProjectFiles(root);
        for (const [name, value] of Object.entries(files)) if (value === null) problems.push(`${name} file is missing`);
      } catch (error) {
        problems.push((error as Error).message);
      }
      const differing = lane ? differingInWorktree(root, lane.root) : [];
      if (args.json) writeJson({ root, ok: problems.length === 0, problems, worktree: lane?.checkout ?? null, differentInWorktree: differing });
      else {
        if (problems.length === 0) say(`every .construct file under ${esc(root)} validates`);
        else for (const p of problems) say(`problem: ${esc(p)}`);
        if (lane && differing.length > 0) {
          say(`note: this worktree's committed ${differing.join(', ')} ${differing.length === 1 ? 'differs' : 'differ'} from the main checkout's; every command reads the main checkout's, under ${esc(root)}`);
        }
      }
      return problems.length === 0 ? 0 : 1;
    }
    case 'refresh':
      return withProject(ctx, ({ root, files, layout, store }) => {
        const at = ctx.now();
        const draft = draftFromMaterial(gatherProjectMaterial(root));
        const applied = applyDiscoveryDraft(store, { draft, at, nextId: ctx.nextId });
        saveConstitution(layout.constitutionFile, composeConstitution(store, files.constitution ?? emptyConstitution()));
        const status = onboardingStatus(store);
        const record = { root, newProposals: applied.proposedStatements.length, openQuestions: status.openQuestions.length, proposalsAwaitingReview: status.proposalsAwaitingReview };
        if (args.json) writeJson(record);
        else {
          say(`re-read ${esc(root)}: ${String(applied.proposedStatements.length)} new proposal(s), ${String(status.proposalsAwaitingReview)} awaiting review, ${String(status.openQuestions.length)} question(s) open`);
          say('Nothing was confirmed; review proposals in your agent session.');
        }
        return 0;
      });
    default:
      throw new UsageError(`project has no subcommand "${sub}"`);
  }
}
