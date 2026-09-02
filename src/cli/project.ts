/**
 * cli/project.ts — show, validate, and refresh the project's own description.
 * Refresh re-reads the project's files and proposes; it confirms nothing.
 */

import { gatherProjectMaterial } from '../hosts/repo/material.ts';
import { draftFromMaterial } from '../kernel/project/discovery.ts';
import { applyDiscoveryDraft, composeConstitution, onboardingStatus } from '../kernel/project/onboarding.ts';
import { constitutionCompleteness, saveConstitution, emptyConstitution } from '../kernel/project/constitution.ts';
import { readProjectFiles } from '../kernel/project/initialize.ts';
import { listStatements } from '../kernel/state/profile.ts';
import type { CommandSpec, ParsedArgs } from './commands.ts';
import { createContext, gitRootOf, withProject, type CliContext } from './context.ts';
import { findProjectRoot, NoProjectError } from '../kernel/project/discover.ts';
import { esc, say, writeJson, UsageError } from './output.ts';

const group = 'Inspect';

export const PROJECT_SPECS: readonly CommandSpec[] = [
  { path: ['project', 'show'], gloss: 'the project’s identity, constitution, and what is still unanswered', group, positionals: [], flags: [], readOnly: true },
  { path: ['project', 'validate'], gloss: 'check every committed .construct file', group, positionals: [], flags: [], readOnly: true },
  { path: ['project', 'refresh'], gloss: 're-read the project’s own files and propose updates; confirms nothing', group: 'Setup', positionals: [], flags: [], readOnly: false },
];

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
      const root = findProjectRoot({ start: ctx.cwd, floor: gitRootOf(ctx.cwd) ?? ctx.cwd });
      if (root === null) throw new NoProjectError(ctx.cwd);
      const bound = { root };
      const problems: string[] = [];
      try {
        const files = readProjectFiles(bound.root);
        for (const [name, value] of Object.entries(files)) if (value === null) problems.push(`${name} file is missing`);
      } catch (error) {
        problems.push((error as Error).message);
      }
      if (args.json) writeJson({ root: bound.root, ok: problems.length === 0, problems });
      else if (problems.length === 0) say(`every .construct file under ${esc(bound.root)} validates`);
      else for (const p of problems) say(`problem: ${esc(p)}`);
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
