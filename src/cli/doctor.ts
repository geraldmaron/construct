/**
 * cli/doctor.ts — is this project actually healthy? Each check names what it
 * looked at and what it found. A missing or broken project is never healthy.
 */

import { existsSync, accessSync, constants } from 'node:fs';
import { detectAmbientHost } from '../hosts/ambient.ts';
import { detectLegacyHomeState, detectLegacyProjectFiles } from '../kernel/project/legacy.ts';
import { readProjectFiles } from '../kernel/project/initialize.ts';
import { constitutionCompleteness } from '../kernel/project/constitution.ts';
import { findProjectRoot } from '../kernel/project/discover.ts';
import { projectLayout } from '../kernel/project/layout.ts';
import { openStateStore } from '../kernel/state/open.ts';
import { getProfile } from '../kernel/state/profile.ts';
import { listShippedSkills, readShippedSkill, skillState, OPERATIONAL_SKILL } from '../kernel/skills/bundle.ts';
import { resolveHostSkillsDir, SKILLS_HOST_NAMES, type SkillsHostName } from '../kernel/paths.ts';
import type { CommandSpec, ParsedArgs } from './commands.ts';
import { createContext, gitRootOf, type CliContext } from './context.ts';
import { esc, say, writeJson } from './output.ts';

export const DOCTOR_SPEC: CommandSpec = {
  path: ['doctor'],
  gloss: 'check the project’s files, state, host binding, skills, and package completeness',
  group: 'Inspect',
  positionals: [],
  flags: [],
  readOnly: true,
};

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const NODE_FLOOR = [22, 18] as const;

function nodeCheck(): Check {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const ok = major! > NODE_FLOOR[0] || (major === NODE_FLOOR[0] && minor! >= NODE_FLOOR[1]);
  return { name: 'node', ok, detail: `v${process.versions.node}${ok ? '' : ` is below the ${NODE_FLOOR.join('.')} floor`}` };
}

export async function doctor(args: ParsedArgs, ctx: CliContext = createContext()): Promise<number> {
  const checks: Check[] = [nodeCheck()];
  const floor = gitRootOf(ctx.cwd) ?? ctx.cwd;
  const root = findProjectRoot({ start: ctx.cwd, floor });

  if (root === null) {
    checks.push({ name: 'project', ok: false, detail: `no Construct project from ${ctx.cwd} up to ${floor}; run \`construct init\`` });
  } else {
    checks.push({ name: 'project', ok: true, detail: root });
    const layout = projectLayout(root);
    const legacy = detectLegacyProjectFiles(root);
    if (legacy.length > 0) {
      checks.push({ name: 'legacy-files', ok: false, detail: `${legacy.map((t) => t.path).join(', ')}: earlier alpha files; run \`construct reset\`` });
    }
    try {
      const files = readProjectFiles(root);
      const missing = (['config', 'constitution', 'sources', 'lock'] as const).filter((k) => files[k] === null);
      checks.push({ name: 'files', ok: missing.length === 0, detail: missing.length === 0 ? 'project, constitution, sources, and lock files validate' : `missing ${missing.join(', ')}` });
      if (files.constitution) {
        const c = constitutionCompleteness(files.constitution);
        checks.push({ name: 'constitution', ok: true, detail: c.complete ? 'complete' : `incomplete: ${c.missing.join(', ')} not yet answered` });
      }
    } catch (error) {
      checks.push({ name: 'files', ok: false, detail: (error as Error).message });
    }
    if (!existsSync(layout.dbPath)) {
      checks.push({ name: 'state', ok: false, detail: `${layout.dbPath} does not exist; run \`construct init\`` });
    } else {
      try {
        accessSync(layout.dbPath, constants.R_OK | constants.W_OK);
        const store = openStateStore(layout.dbPath);
        try {
          const profile = getProfile(store);
          checks.push({ name: 'state', ok: true, detail: `format 2 at ${layout.dbPath}; onboarding ${profile?.onboardingState ?? 'incomplete'}` });
        } finally {
          store.close();
        }
      } catch (error) {
        checks.push({ name: 'state', ok: false, detail: (error as Error).message });
      }
    }
  }

  const ambient = detectAmbientHost(ctx.env);
  if (ambient) {
    checks.push({ name: 'host', ok: true, detail: `inside ${ambient.host} (${ambient.marker})` });
    if ((SKILLS_HOST_NAMES as readonly string[]).includes(ambient.host)) {
      const dir = resolveHostSkillsDir(ambient.host as SkillsHostName, ctx.env);
      const skill = readShippedSkill(OPERATIONAL_SKILL);
      if (skill) {
        const state = skillState(skill, dir);
        checks.push({ name: 'operational-skill', ok: state.state === 'current', detail: `${state.state} in ${dir}: ${state.why}` });
      }
    }
  } else {
    checks.push({ name: 'host', ok: true, detail: 'no agent host detected in this shell; that is fine for setup and inspection' });
  }

  const shipped = listShippedSkills();
  checks.push({ name: 'package', ok: shipped.some((s) => s.name === OPERATIONAL_SKILL), detail: `${String(shipped.length)} skill(s) shipped${shipped.some((s) => s.name === OPERATIONAL_SKILL) ? '' : `; the ${OPERATIONAL_SKILL} skill is missing from this install`}` });

  const oldHome = detectLegacyHomeState(ctx.paths);
  if (oldHome.length > 0) {
    checks.push({ name: 'legacy-home-state', ok: true, detail: `${oldHome.map((t) => t.path).join(', ')}: earlier alpha data this version never reads; \`construct reset\` can name it for removal` });
  }

  const failed = checks.filter((c) => !c.ok).length;
  if (args.json) {
    writeJson({ healthy: failed === 0, checks });
    return failed === 0 ? 0 : 1;
  }
  for (const c of checks) say(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${esc(c.detail)}`);
  say(failed === 0 ? 'doctor: healthy' : `doctor: ${String(failed)} check(s) failed`);
  return failed === 0 ? 0 : 1;
}
