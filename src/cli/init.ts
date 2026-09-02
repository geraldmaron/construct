/**
 * cli/init.ts — set a project up: files, one database, a drafted profile with
 * provenance, the three onboarding questions (answered from flags when given),
 * and the operational skill planted in the host the person is already in.
 */

import { existsSync } from 'node:fs';
import { gatherProjectMaterial } from '../hosts/repo/material.ts';
import { detectAmbientHost } from '../hosts/ambient.ts';
import { initializeProject } from '../kernel/project/initialize.ts';
import { draftFromMaterial } from '../kernel/project/discovery.ts';
import { applyDiscoveryDraft, applyOnboardingAnswers, composeConstitution, onboardingStatus } from '../kernel/project/onboarding.ts';
import { saveConstitution } from '../kernel/project/constitution.ts';
import { PROJECT_SCALES, type ProjectScale } from '../kernel/state/profile.ts';
import { createSourceService } from '../kernel/source/service.ts';
import { ensureSourceEntities } from '../kernel/source/entities.ts';
import { listShippedSkills, readShippedSkill, plantSkill, OPERATIONAL_SKILL } from '../kernel/skills/bundle.ts';
import { resolveHostSkillsDir, SKILLS_HOST_NAMES, type SkillsHostName } from '../kernel/paths.ts';
import { boolFlag, listFlag, stringFlag, type CommandSpec, type ParsedArgs } from './commands.ts';
import { createContext, initRootFor, type CliContext } from './context.ts';
import { esc, say, writeJson, UsageError } from './output.ts';
import { basename } from 'node:path';

export const INIT_SPEC: CommandSpec = {
  path: ['init'],
  gloss: 'set this project up: files, one database, a drafted profile, the operational skill in your host',
  group: 'Setup',
  positionals: [],
  flags: [
    { name: 'name', gloss: 'the project’s name (default: the directory or package name)', takesValue: true },
    { name: 'purpose', gloss: 'what the project is for, in a sentence', takesValue: true },
    { name: 'scale', gloss: `what this is to you: ${PROJECT_SCALES.join(' | ')}`, takesValue: true },
    { name: 'outcome', gloss: 'the result that matters most right now', takesValue: true },
    { name: 'constraint', gloss: 'something Construct must be careful not to change or violate', takesValue: true, repeatable: true },
    { name: 'client', gloss: `plant the operational skill for this host: ${SKILLS_HOST_NAMES.join(' | ')}`, takesValue: true },
    { name: 'skills-dir', gloss: 'plant the operational skill into this directory instead of a host’s', takesValue: true },
    { name: 'dry-run', gloss: 'say what would happen and write nothing', takesValue: false },
  ],
  readOnly: false,
};

function resolveSkillsDir(args: ParsedArgs, ctx: CliContext): { readonly dir: string | null; readonly how: string } {
  const explicit = stringFlag(args, 'skills-dir');
  if (explicit) return { dir: explicit, how: '--skills-dir' };
  const client = stringFlag(args, 'client');
  if (client !== undefined) {
    if (!(SKILLS_HOST_NAMES as readonly string[]).includes(client)) {
      throw new UsageError(`--client must be one of ${SKILLS_HOST_NAMES.join(' | ')}`);
    }
    return { dir: resolveHostSkillsDir(client as SkillsHostName, ctx.env), how: `--client=${client}` };
  }
  const ambient = detectAmbientHost(ctx.env);
  if (ambient && (SKILLS_HOST_NAMES as readonly string[]).includes(ambient.host)) {
    return { dir: resolveHostSkillsDir(ambient.host as SkillsHostName, ctx.env), how: `detected ${ambient.host} (${ambient.marker})` };
  }
  return { dir: null, how: 'no host detected; pass --client=<host> or --skills-dir=<dir>' };
}

export async function init(args: ParsedArgs, ctx: CliContext = createContext()): Promise<number> {
  const scale = stringFlag(args, 'scale');
  if (scale !== undefined && !(PROJECT_SCALES as readonly string[]).includes(scale)) {
    throw new UsageError(`--scale must be one of ${PROJECT_SCALES.join(' | ')}`);
  }
  const root = initRootFor(ctx.cwd);
  const material = gatherProjectMaterial(root);
  const draft = draftFromMaterial(material);
  const name = stringFlag(args, 'name') ?? draft.profile.find((p) => p.field === 'name')?.value ?? basename(root);
  const skills = resolveSkillsDir(args, ctx);
  const dryRun = boolFlag(args, 'dry-run');

  if (dryRun) {
    const record = {
      root,
      wouldWrite: ['.construct/project.json', '.construct/constitution.json', '.construct/sources.json', '.construct/registry.lock.json', '.construct/state/construct.sqlite'],
      proposals: draft.statements.length + draft.profile.length + draft.ownership.length,
      questions: draft.questions.map((q) => q.id),
      operationalSkill: skills.dir ? `${skills.dir} (${skills.how})` : `skipped: ${skills.how}`,
    };
    if (args.json) {
      writeJson(record);
      return 0;
    }
    say(`construct init (dry run) in ${esc(root)}`);
    say(`  would write: ${record.wouldWrite.join(', ')}`);
    say(`  would propose ${String(record.proposals)} item(s) read from the project’s own files, each with its source`);
    say(`  would ask: ${record.questions.join(', ')}`);
    say(`  operational skill: ${esc(record.operationalSkill)}`);
    say('Nothing was written.');
    return 0;
  }

  const at = ctx.now();
  const result = initializeProject({ root, projectId: ctx.nextId('proj'), name, at });
  try {
    const applied = applyDiscoveryDraft(result.store, { draft, at, nextId: ctx.nextId });
    const answers = applyOnboardingAnswers(result.store, {
      answers: {
        name: stringFlag(args, 'name'),
        purpose: stringFlag(args, 'purpose'),
        scale: scale as ProjectScale | undefined,
        primaryOutcome: stringFlag(args, 'outcome'),
        protectedConstraints: listFlag(args, 'constraint'),
      },
      by: 'init',
      at,
      nextId: ctx.nextId,
    });
    saveConstitution(result.layout.constitutionFile, composeConstitution(result.store, result.constitution));
    const sources = createSourceService(result.store, { readers: new Map() });
    const synced = sources.syncDeclarations(result.sources, at);
    ensureSourceEntities(result.store, at, ctx.nextId);
    const status = onboardingStatus(result.store);

    let skillLine: string;
    let skillOk = false;
    if (skills.dir) {
      const skill = readShippedSkill(OPERATIONAL_SKILL);
      if (!skill) {
        skillLine = `skipped: this install ships no ${OPERATIONAL_SKILL} skill (${String(listShippedSkills().length)} skills found)`;
      } else {
        const planted = plantSkill(skill, skills.dir);
        skillOk = planted.outcome !== 'refused';
        skillLine = `${planted.outcome} at ${planted.path} (${planted.why}; ${skills.how})`;
      }
    } else {
      skillLine = `skipped: ${skills.how}`;
    }

    const record = {
      root,
      created: result.created,
      gitignoreUpdated: result.gitignoreUpdated,
      profile: { name: answers.profile.name, onboardingState: answers.profile.onboardingState, missing: answers.missing },
      proposed: applied.proposedStatements.length,
      openQuestions: status.openQuestions.map((q) => q.question),
      sources: synced,
      operationalSkill: skillLine,
    };
    if (args.json) {
      writeJson(record);
      return 0;
    }
    const fresh = Object.values(result.created).some(Boolean);
    say(`${fresh ? 'Initialized' : 'Reconciled'} Construct project "${esc(String(answers.profile.name))}" at ${esc(root)}`);
    say(`  files: .construct/{project,constitution,sources,registry.lock}.json${result.gitignoreUpdated ? '; .gitignore now ignores .construct/state/' : ''}`);
    say(`  state: ${result.created.state ? 'created' : 'opened'} .construct/state/construct.sqlite`);
    say(`  read from the project: ${String(applied.proposedStatements.length)} proposal(s), each with its source, waiting for your review`);
    if (status.openQuestions.length > 0) {
      say(`  still to answer (${String(status.openQuestions.length)}):`);
      for (const q of status.openQuestions) say(`    - ${esc(q.question)}`);
    } else {
      say('  onboarding: confirmed');
    }
    say(`  operational skill: ${esc(skillLine)}`);
    if (!skillOk && skills.dir) say('  (the skill was not planted; see above)');
    say(status.openQuestions.length > 0
      ? 'Next: answer the questions in your agent session, or pass --scale, --outcome, and --constraint to init.'
      : 'Next: talk in your agent session. `construct status` shows where things stand.');
    if (!existsSync(result.layout.lockFile)) say('  note: no registry lock was written');
    return 0;
  } finally {
    result.store.close();
  }
}
