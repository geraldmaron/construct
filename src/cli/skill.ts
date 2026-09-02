/**
 * cli/skill.ts — the skills this install ships, and planting them into a
 * host's skills directory when a host needs files on disk.
 */

import { listShippedSkills, readShippedSkill, plantSkill, removeSkill, skillState } from '../kernel/skills/bundle.ts';
import { resolveHostSkillsDir, SKILLS_HOST_NAMES, type SkillsHostName } from '../kernel/paths.ts';
import { detectAmbientHost } from '../hosts/ambient.ts';
import { boolFlag, stringFlag, type CommandSpec, type ParsedArgs } from './commands.ts';
import { createContext, type CliContext } from './context.ts';
import { esc, say, writeJson, UsageError, OperationError } from './output.ts';

const group = 'Skills';
const dirFlag = { name: 'dir', gloss: 'the skills directory to use instead of the detected host’s', takesValue: true } as const;
const clientFlag = { name: 'client', gloss: `the host whose skills directory to use: ${SKILLS_HOST_NAMES.join(' | ')}`, takesValue: true } as const;

export const SKILL_SPECS: readonly CommandSpec[] = [
  { path: ['skill', 'list'], gloss: 'the skills this install ships, with versions', group, positionals: [], flags: [], readOnly: true },
  { path: ['skill', 'show'], gloss: 'one skill’s description, version, and files', group, positionals: ['<name>'], flags: [], readOnly: true },
  { path: ['skill', 'install'], gloss: 'plant a shipped skill into a host’s skills directory, byte for byte', group, positionals: ['<name>'], flags: [dirFlag, clientFlag, { name: 'force', gloss: 'overwrite a copy that differs', takesValue: false }], readOnly: false },
  { path: ['skill', 'verify'], gloss: 'compare installed skills with the shipped ones', group, positionals: [], flags: [dirFlag, clientFlag], readOnly: true },
  { path: ['skill', 'remove'], gloss: 'remove an installed skill (needs --confirm)', group, positionals: ['<name>'], flags: [dirFlag, clientFlag, { name: 'confirm', gloss: 'actually remove it', takesValue: false }], readOnly: false },
];

function installDir(args: ParsedArgs, ctx: CliContext): string {
  const dir = stringFlag(args, 'dir');
  if (dir) return dir;
  const client = stringFlag(args, 'client');
  if (client !== undefined) {
    if (!(SKILLS_HOST_NAMES as readonly string[]).includes(client)) throw new UsageError(`--client must be one of ${SKILLS_HOST_NAMES.join(' | ')}`);
    return resolveHostSkillsDir(client as SkillsHostName, ctx.env);
  }
  const ambient = detectAmbientHost(ctx.env);
  if (ambient && (SKILLS_HOST_NAMES as readonly string[]).includes(ambient.host)) return resolveHostSkillsDir(ambient.host as SkillsHostName, ctx.env);
  throw new UsageError(`no host detected; pass --client=<${SKILLS_HOST_NAMES.join('|')}> or --dir=<path>`);
}

export function skillCommand(sub: string, args: ParsedArgs, ctx: CliContext = createContext()): number {
  switch (sub) {
    case 'list': {
      const skills = listShippedSkills();
      if (args.json) {
        writeJson(skills.map((s) => ({ name: s.name, version: s.version, description: s.description, files: s.files.length })));
        return 0;
      }
      if (skills.length === 0) {
        say('this install carries no skill files');
        return 1;
      }
      const width = Math.max(...skills.map((s) => s.name.length));
      for (const s of skills) say(`${s.name.padEnd(width)}  ${s.version ?? '-'}  ${esc(s.description)}`);
      return 0;
    }
    case 'show': {
      const skill = readShippedSkill(args.positionals[0]!);
      if (!skill) throw new OperationError(`no shipped skill named ${args.positionals[0]!}`, '`construct skill list` shows them.');
      if (args.json) writeJson({ name: skill.name, version: skill.version, description: skill.description, files: skill.files.map((f) => f.relativePath) });
      else {
        say(`${skill.name} ${skill.version ?? ''}`.trim());
        say(`  ${esc(skill.description)}`);
        say(`  files: ${skill.files.map((f) => f.relativePath).join(', ')}`);
      }
      return 0;
    }
    case 'install': {
      const skill = readShippedSkill(args.positionals[0]!);
      if (!skill) throw new OperationError(`no shipped skill named ${args.positionals[0]!}`, '`construct skill list` shows them.');
      const dir = installDir(args, ctx);
      const result = plantSkill(skill, dir, { force: boolFlag(args, 'force') });
      if (args.json) writeJson(result);
      else say(`${skill.name}: ${result.outcome} at ${esc(result.path)} (${esc(result.why)})`);
      return result.outcome === 'refused' ? 1 : 0;
    }
    case 'verify': {
      const dir = installDir(args, ctx);
      const rows = listShippedSkills().map((s) => ({ name: s.name, ...skillState(s, dir) }));
      if (args.json) writeJson({ dir, skills: rows });
      else for (const r of rows) say(`${r.name}: ${r.state} (${esc(r.why)})`);
      return 0;
    }
    case 'remove': {
      const name = args.positionals[0]!;
      const dir = installDir(args, ctx);
      if (!boolFlag(args, 'confirm')) {
        say(`would remove ${esc(dir)}/${esc(name)}. Nothing was removed; re-run with --confirm.`);
        return 0;
      }
      const result = removeSkill(name, dir);
      if (args.json) writeJson(result);
      else say(result.why);
      return result.removed ? 0 : 1;
    }
    default:
      throw new UsageError(`skill has no subcommand "${sub}"`);
  }
}
