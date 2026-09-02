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
import { createSkillRegistry } from '../kernel/registry/skill-registry.ts';
import { createWorkflowRegistry } from '../kernel/registry/workflow-registry.ts';
import { updateLock } from '../kernel/registry/lockfile.ts';
import { writeJsonFile } from '../kernel/project/files.ts';
import { installWiring } from '../hosts/wiring/wire.ts';
import { clientWiring, normalizeClient, WIRABLE_CLIENTS, type WirableClient } from '../hosts/wiring/clients.ts';
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
    { name: 'client', gloss: `the host you use: plants its skill and wires its MCP config (${WIRABLE_CLIENTS.join(' | ')}, bob, codex)`, takesValue: true },
    { name: 'no-wire', gloss: 'do not write the host’s MCP configuration', takesValue: false },
    { name: 'skills-dir', gloss: 'plant the operational skill into this directory instead of a host’s', takesValue: true },
    { name: 'dry-run', gloss: 'say what would happen and write nothing', takesValue: false },
  ],
  readOnly: false,
};

/** The skills directory a host name maps to; vscode reads none of its own. */
function skillsHostFor(client: string): SkillsHostName | null {
  const map: Record<string, SkillsHostName> = { claude: 'claude', 'claude-code': 'claude', cursor: 'cursor', opencode: 'opencode', codex: 'codex', bob: 'bob' };
  return map[client] ?? null;
}

function wiringClientFor(args: ParsedArgs, ctx: CliContext): WirableClient | null {
  const explicit = stringFlag(args, 'client');
  const id = normalizeClient(explicit ?? detectAmbientHost(ctx.env)?.host);
  return clientWiring(id) ? (id as WirableClient) : null;
}

function resolveSkillsDir(args: ParsedArgs, ctx: CliContext): { readonly dir: string | null; readonly how: string } {
  const explicit = stringFlag(args, 'skills-dir');
  if (explicit) return { dir: explicit, how: '--skills-dir' };
  const client = stringFlag(args, 'client');
  if (client !== undefined) {
    const skillsHost = skillsHostFor(client);
    if (skillsHost) return { dir: resolveHostSkillsDir(skillsHost, ctx.env), how: `--client=${client}` };
    if (normalizeClient(client) === null) throw new UsageError(`--client must be one of ${[...WIRABLE_CLIENTS, 'bob', 'codex'].join(' | ')}`);
    return { dir: null, how: `${client} documents no personal skills directory; pass --skills-dir=<dir> to plant the operational skill where it reads` };
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
      hostWiring: wiringClientFor(args, ctx),
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
    say(`  host wiring: ${record.hostWiring ? `would write MCP config for ${record.hostWiring}` : 'none'}`);
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
    const skillRegistry = createSkillRegistry({ projectDir: result.layout.skillsDir });
    const workflowRegistry = createWorkflowRegistry({ projectDir: result.layout.workflowsDir });
    const locked = updateLock(result.lock, skillRegistry.list(), workflowRegistry.list());
    if (locked.changed.length > 0 || locked.removed.length > 0) writeJsonFile(result.layout.lockFile, locked.lock);
    const status = onboardingStatus(result.store);

    const wireClient = boolFlag(args, 'no-wire') ? null : wiringClientFor(args, ctx);
    const wiring = wireClient ? installWiring(wireClient, root) : null;
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
      hostWiring: wiring ? { client: wiring.client, path: wiring.path, status: wiring.status } : null,
      registry: { locked: Object.keys(locked.lock.skills).length + Object.keys(locked.lock.workflows).length, updated: locked.changed.length, awaitingConfirmation: locked.needsConfirmation },
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
    say(`  registry: ${String(Object.keys(locked.lock.skills).length)} skill(s), ${String(Object.keys(locked.lock.workflows).length)} workflow(s) locked${locked.needsConfirmation.length ? `; ${String(locked.needsConfirmation.length)} project bundle(s) changed and await confirmation` : ''}`);
    say(`  operational skill: ${esc(skillLine)}`);
    if (!skillOk && skills.dir) say('  (the skill was not planted; see above)');
    say(wiring ? `  host: ${wiring.client} ${wiring.status} (${esc(wiring.detail)})` : `  host: no MCP configuration written${boolFlag(args, 'no-wire') ? ' (--no-wire)' : '; pass --client=<host> to wire one'}`);
    say(status.openQuestions.length > 0
      ? 'Next: answer the questions in your agent session, or pass --scale, --outcome, and --constraint to init.'
      : 'Next: talk in your agent session. `construct status` shows where things stand.');
    if (!existsSync(result.layout.lockFile)) say('  note: no registry lock was written');
    return 0;
  } finally {
    result.store.close();
  }
}
