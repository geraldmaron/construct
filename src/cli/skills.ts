/**
 * cli/skills.ts — two things share this verb, and the first word decides which.
 *
 * The subcommands carry the portable method skills this checkout ships into a
 * host's skills directory, as exact copies. The flag form writes or removes the
 * generated role pack, which is output rather than state: every decision about
 * what belongs in it, and which folders a removal may touch, is the kernel
 * projection's; this file supplies the version, does the reading and writing,
 * and says what happened.
 */

import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';

const { O_WRONLY, O_CREAT, O_TRUNC, O_NOFOLLOW } = constants;
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveHostSkillsDir, resolveSkillsDir, SKILLS_HOST_NAMES, type SkillsHostName } from '../kernel/paths.ts';
import {
  planSkillsUninstall,
  projectSkillsPack,
  SKILL_FILENAME,
  wrap as wrapSkillText,
  type SkillFolder,
} from '../kernel/skills/projection.ts';
import {
  foreignFolders,
  planSkillRemoval,
  sameSkillBytes,
  selectSkills,
  skillDescription,
  skillStatuses,
  skillVersion,
  SHIPPED_SKILLS,
  type InstalledFolder,
  type SkillSource,
} from '../kernel/skills/library.ts';
import { skillsReachable, type SkillsReachable } from '../kernel/skills/reach.ts';
import { LENSES } from '../kernel/plan/lenses.ts';
import { allPlaybooks } from '../kernel/plan/playbooks.ts';
import { LENS_STANDARDS } from '../kernel/plan/standards.ts';
import { packageVersion } from './runtime.ts';
import { parseFlags } from './flags.ts';

/** The immediate subfolders of a skills directory, read for their SKILL.md if they have one. */
export function readSkillFolders(dir: string): readonly SkillFolder[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = join(dir, entry.name, SKILL_FILENAME);
      return {
        directory: entry.name,
        skill: existsSync(file) ? readFileSync(file, 'utf8') : null,
      };
    });
}

const SKILLS_USAGE =
  'usage: construct skills list\n' +
  '       construct skills install <name>... [--dir=<dir>|--host=<host>] [--force]\n' +
  '       construct skills install --all [--dir=<dir>|--host=<host>] [--force]\n' +
  '       construct skills installed [--dir=<dir>|--host=<host>]\n' +
  '       construct skills uninstall <name> [--dir=<dir>|--host=<host>]\n' +
  '       construct skills [--out=<dir>] [--uninstall]\n' +
  '  The first five carry the portable method skills this checkout ships, into\n' +
  `  a host skills directory (--dir, default ~/.claude/skills; or --host=<${SKILLS_HOST_NAMES.join('|')}>\n` +
  '  for a documented host directory — --dir and --host are mutually exclusive).\n' +
  '  install refuses a target that differs from this checkout\'s copy — edited\n' +
  '  by hand, or installed from another version — unless --force is given.\n' +
  '  The last writes or removes the generated role pack (--out, default\n' +
  '  ./.claude/skills) — output regenerated from the role catalog, not a copy.\n';

/**
 * The first symbolic link sitting at `root` or on the path from it down to
 * `target`, or null when every existing component is a real directory. The
 * walk stops at the first component that does not exist — nothing past it
 * can be a link to follow.
 */
function symlinkToward(root: string, target: string): string | null {
  const stops = [root];
  let current = root;
  for (const part of relative(root, target).split(sep)) {
    if (!part || part === '.') continue;
    current = join(current, part);
    stops.push(current);
  }
  for (const stop of stops) {
    try {
      if (lstatSync(stop).isSymbolicLink()) return stop;
    } catch {
      break;
    }
  }
  return null;
}

/**
 * Where the symlink walk toward `out` starts. The checked-out tree is what an
 * attacker can plant links in, so an `out` under the working directory is
 * walked from the working directory down — a planted `.claude` parent is a
 * component on that walk, where lstat of `out` alone would silently follow
 * it. An `out` elsewhere is walked from itself: its parents are the user's
 * own machine, not the repository's to plant. Containment is by path
 * segment, never by string prefix.
 */
function symlinkGuardRoot(out: string): string {
  const cwd = process.cwd();
  const rel = relative(cwd, out);
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel) ? cwd : out;
}

/** The subcommands that carry the shipped method skills, as opposed to the pack. */
const SKILL_LIBRARY_SUBCOMMANDS = ['list', 'install', 'installed', 'uninstall'];

/**
 * Where this install keeps the portable method skills, resolved from this
 * module rather than from the working directory, so it is the same directory
 * wherever the command is run from. One relative path serves both layouts: the
 * checkout runs this from `src/cli/` and a package runs its build from
 * `dist/cli/`, and `skills/` sits two levels up from either. An install whose
 * skill files are missing is a broken one, and the command says so rather than
 * working around it.
 */
function sourceSkillsDir(): string {
  return fileURLToPath(new URL('../../skills/', import.meta.url));
}

const SKILLS_ABSENT =
  'skills: this install carries no skill files, which a complete one always does.\n' +
  '  Reinstall the package, or run this from a git checkout. The skills are also\n' +
  "  installable straight from git, via Vercel's third-party `skills` installer\n" +
  '  (not this project — it resolves at whatever version npx finds latest):\n' +
  '    npx skills add geraldmaron/construct\n';

/** Every shipped skill, in name order, read whole so a copy of it is a copy of the bytes. */
function readSkillSources(dir: string): readonly SkillSource[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, SKILL_FILENAME)))
    .map((entry) => {
      const bytes = readFileSync(join(dir, entry.name, SKILL_FILENAME));
      return {
        name: entry.name,
        description: skillDescription(bytes),
        version: skillVersion(bytes),
        bytes,
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** One folder at the install target: the file an install writes, and anything else. */
function readInstalledFolder(dir: string, name: string): InstalledFolder {
  const entries = readdirSync(join(dir, name));
  const skillFile = join(dir, name, SKILL_FILENAME);
  return {
    name,
    // A dangling link or a directory wearing the name is not the file an
    // install writes, and reporting it as one would be the lie this command
    // exists to avoid.
    skill: existsSync(skillFile) && statSync(skillFile).isFile() ? readFileSync(skillFile) : null,
    extras: entries.filter((entry) => entry !== SKILL_FILENAME).sort(),
  };
}

/**
 * What the install target holds. Reading only — a target that does not exist
 * reads as empty and stays that way, because looking is not installing.
 */
function readInstalledFolders(dir: string): readonly InstalledFolder[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readInstalledFolder(dir, entry.name));
}

/**
 * What a dispatched role can get at from the portable method library on this
 * machine. A run reads exactly two directories and no others: the agent skills
 * directory a host loads from, and this checkout's own copies where the
 * install has them. Neither is chosen by the role, and nothing here is copied,
 * rewritten, or wrapped, so a skill the role loads is the same file anyone
 * else would load.
 *
 * The reading is here rather than in the kernel for the reason every other
 * disk read is: the kernel receives described values, and the surface that
 * owns paths does the looking.
 */
export function readReachableSkills(installDir = resolveSkillsDir()): SkillsReachable {
  const sourceDir = sourceSkillsDir().replace(new RegExp(`${sep}+$`), '');
  const shipped = existsSync(sourceDir);
  return skillsReachable({
    shipped: SHIPPED_SKILLS,
    sources: shipped ? readSkillSources(sourceDir) : [],
    installed: readInstalledFolders(installDir),
    installDir,
    sourceDir: shipped ? sourceDir : null,
  });
}

function padded(values: readonly string[]): (value: string) => string {
  const width = values.reduce((widest, value) => Math.max(widest, value.length), 0);
  return (value: string) => value.padEnd(width);
}

/**
 * The shipped method skills, carried into a host's skills directory as exact
 * copies. Nothing records what was installed: the target directory is the
 * record, and comparing its bytes against this checkout's is what answers
 * whether a copy is current. So the report can be wrong only if the disk is,
 * and a skill copied in by hand is seen exactly like one this command wrote.
 */
function skillLibrary(sub: string, argv: string[]): number {
  const { flags, rest } = parseFlags(argv);
  const permitted =
    sub === 'install' ? ['dir', 'host', 'all', 'force'] : sub === 'list' ? [] : ['dir', 'host'];
  const unknown = Object.keys(flags).filter((flag) => !permitted.includes(flag));
  if (
    unknown.length > 0 ||
    flags.dir === 'true' ||
    flags.host === 'true' ||
    (flags.all ?? 'true') !== 'true' ||
    (flags.force ?? 'true') !== 'true'
  ) {
    process.stderr.write(SKILLS_USAGE);
    return 2;
  }
  if (flags.dir !== undefined && flags.host !== undefined) {
    process.stderr.write(
      'skills: --dir and --host name the same thing two ways — pass only one.\n' +
        `  (got --dir=${flags.dir} and --host=${flags.host})\n`,
    );
    return 2;
  }
  if (flags.host !== undefined && !(SKILLS_HOST_NAMES as readonly string[]).includes(flags.host)) {
    process.stderr.write(
      `skills: no known host named "${flags.host}" (expected ${SKILLS_HOST_NAMES.join(', ')})\n` +
        '  Name a directory of your own with --dir instead.\n',
    );
    return 2;
  }

  const sourceDir = sourceSkillsDir();
  if (!existsSync(sourceDir)) {
    process.stderr.write(SKILLS_ABSENT);
    return 1;
  }
  const sources = readSkillSources(sourceDir);

  if (sub === 'list') {
    if (rest.length > 0) {
      process.stderr.write(SKILLS_USAGE);
      return 2;
    }
    // The whole description, wrapped rather than cut: it is what decides
    // whether a host reaches for the skill, so a shortened one would be a
    // different skill's description.
    for (const source of sources) {
      process.stdout.write(
        `  ${source.name} ${source.version ?? '-'}\n${wrapSkillText(source.description, '    ')}\n`,
      );
    }
    process.stdout.write(
      `skills: ${String(sources.length)} shipped by this checkout\n` +
        '  Install one with: construct skills install <name>\n',
    );
    return 0;
  }

  const dir = resolve(
    flags.host !== undefined
      ? resolveHostSkillsDir(flags.host as SkillsHostName)
      : (flags.dir ?? resolveSkillsDir()),
  );

  if (sub === 'installed') {
    if (rest.length > 0) {
      process.stderr.write(SKILLS_USAGE);
      return 2;
    }
    const folders = readInstalledFolders(dir);
    const statuses = skillStatuses(sources, folders);
    const name = padded(statuses.map((status) => status.name));
    for (const status of statuses) {
      process.stdout.write(
        `  ${status.state.padEnd(9)} ${name(status.name)}  ${status.version ?? '-'}  — ${status.why}\n`,
      );
    }
    const counted = (state: string): number =>
      statuses.filter((status) => status.state === state).length;
    const others = foreignFolders(sources, folders);
    process.stdout.write(
      `skills: ${String(counted('current'))} current, ${String(counted('diverged'))} diverged, ` +
        `${String(counted('absent'))} not installed in ${dir}` +
        `${existsSync(dir) ? '' : ' (which does not exist)'}\n` +
        (others.length > 0
          ? `  ${String(others.length)} other skill folder(s) there, none of them this checkout's\n`
          : ''),
    );
    return 0;
  }

  if (sub === 'install') {
    return skillInstall(sources, dir, rest, flags.all === 'true', flags.force === 'true');
  }
  return skillUninstall(sources, dir, rest);
}

function skillInstall(
  sources: readonly SkillSource[],
  dir: string,
  named: readonly string[],
  all: boolean,
  force: boolean,
): number {
  // Either every skill or the ones named, never both and never neither: an
  // install that guessed at its own subject would write files nobody asked for.
  if (all === named.length > 0) {
    process.stderr.write(SKILLS_USAGE);
    return 2;
  }
  const { selected, unknown } = all
    ? { selected: sources, unknown: [] as readonly string[] }
    : selectSkills(sources, named);
  if (unknown.length > 0) {
    process.stderr.write(
      `skills: no skill named ${unknown.map((name) => `"${name}"`).join(', ')} in this checkout\n` +
        '  construct skills list names what there is.\n',
    );
    return 2;
  }

  // Every target is checked before anything is created, so a refusal never
  // leaves a partial install behind.
  for (const source of selected) {
    const planted = symlinkToward(symlinkGuardRoot(dir), join(dir, source.name, SKILL_FILENAME));
    if (planted) {
      process.stderr.write(
        `skills: ${planted} is a symbolic link — writing through it would land outside ${dir}.\n` +
          '  Remove the link, or point --dir at the real directory.\n',
      );
      return 1;
    }
  }

  // Same pass, before anything is written: a target that differs from this
  // checkout's copy was either edited by hand or planted by another version,
  // and an install that overwrote it without being told to would destroy
  // whichever one it was silently. --force is the only way past this.
  if (!force) {
    const diverged: string[] = [];
    for (const source of selected) {
      const target = join(dir, source.name, SKILL_FILENAME);
      const existing = existsSync(target) ? readFileSync(target) : null;
      if (existing !== null && !sameSkillBytes(existing, source.bytes)) diverged.push(source.name);
    }
    if (diverged.length > 0) {
      process.stderr.write(
        `skills: ${diverged.join(', ')} at ${dir} ${diverged.length === 1 ? 'differs' : 'differ'} from this checkout's copy — edited there, or installed from another version.\n` +
          '  Installing would overwrite it. Pass --force to overwrite anyway.\n',
      );
      return 1;
    }
  }

  let written = 0;
  for (const source of selected) {
    const target = join(dir, source.name, SKILL_FILENAME);
    const existing = existsSync(target) ? readFileSync(target) : null;
    if (existing !== null && sameSkillBytes(existing, source.bytes)) {
      process.stdout.write(`  current   ${source.name} — already byte-identical, left alone\n`);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    // Opened with O_NOFOLLOW rather than written through writeFileSync, so a
    // symlink planted at the target's final path component after the guard
    // pass above (and after the divergence read just taken) is refused at
    // the write itself — the guard pass checks the path once, and this is
    // what keeps the promise made between that check and this write.
    let fd: number;
    try {
      fd = openSync(target, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        process.stderr.write(
          `skills: ${target} is a symbolic link — writing through it would land outside ${dir}.\n` +
            '  Remove the link, or point --dir at the real directory.\n',
        );
        return 1;
      }
      throw error;
    }
    try {
      writeSync(fd, source.bytes);
    } finally {
      closeSync(fd);
    }
    written += 1;
    process.stdout.write(
      `  ${existing === null ? 'installed' : 'replaced '} ${source.name} ${source.version ?? '-'}\n`,
    );
  }
  process.stdout.write(
    `skills: ${String(written)} of ${String(selected.length)} written to ${dir}, copied byte for byte\n` +
      '  See them with: construct skills installed\n',
  );
  return 0;
}

function skillUninstall(
  sources: readonly SkillSource[],
  dir: string,
  named: readonly string[],
): number {
  if (named.length !== 1) {
    process.stderr.write(SKILLS_USAGE);
    return 2;
  }
  const name = named[0];
  const source = sources.find((candidate) => candidate.name === name);
  if (!source) {
    process.stderr.write(
      `skills: no skill named "${name}" in this checkout — nothing was removed\n` +
        '  construct skills installed names what is there.\n',
    );
    return 2;
  }
  // Removal reaches through the directory exactly as writing does, so it
  // refuses a symbolic link the same way: a removal redirected by a link would
  // delete a folder somewhere the user never named.
  const planted = symlinkToward(symlinkGuardRoot(dir), join(dir, name));
  if (planted) {
    process.stderr.write(
      `skills: ${planted} is a symbolic link — removing through it would reach outside ${dir}.\n` +
        '  Remove the link, or point --dir at the real directory.\n',
    );
    return 1;
  }
  const folder = join(dir, name);
  const plan = planSkillRemoval(
    source,
    existsSync(folder) && statSync(folder).isDirectory()
      ? readInstalledFolder(dir, name)
      : undefined,
  );
  if (plan.outcome === 'absent') {
    process.stdout.write(`skills: nothing to remove — ${name} is not installed in ${dir}\n`);
    return 0;
  }
  if (plan.outcome === 'keep') {
    process.stderr.write(
      `skills: kept ${name} — ${plan.why}\n` +
        `  Nothing was removed. Delete ${folder} by hand if that is what you meant.\n`,
    );
    return 1;
  }
  rmSync(folder, { recursive: true, force: true });
  process.stdout.write(`skills: removed ${name} from ${dir}\n  ${plan.why}\n`);
  return 0;
}

/**
 * Write the Agent Skills pack, or remove one. The pack is output, not state:
 * every decision about what belongs in it, and which folders removal may
 * touch, is made by the kernel projection; this command only supplies the
 * version, does the reading and writing, and says what happened.
 */
export function skills(argv: string[]): number {
  // Two things share this verb: the shipped method skills, carried by the
  // subcommands, and the role pack, generated by the flag form. The first word
  // decides which, and the flag form takes no words at all — so a mistyped
  // subcommand is refused rather than silently writing a pack.
  if (SKILL_LIBRARY_SUBCOMMANDS.includes(argv[0])) return skillLibrary(argv[0], argv.slice(1));

  const { flags, rest } = parseFlags(argv);
  const known = new Set(['out', 'uninstall']);
  const unknown = Object.keys(flags).filter((f) => !known.has(f));
  if (unknown.length > 0 || rest.length > 0 || flags.out === 'true') {
    process.stderr.write(SKILLS_USAGE);
    return 2;
  }
  const out = resolve(flags.out ?? join(process.cwd(), '.claude', 'skills'));

  if (flags.uninstall === 'true') {
    // Removal reaches through `out` exactly as writing does, so it refuses a
    // symbolic link the same way — an uninstall redirected by a planted link
    // would delete construct-* folders somewhere the user never named.
    const planted = symlinkToward(symlinkGuardRoot(out), out);
    if (planted) {
      process.stderr.write(
        `skills: ${planted} is a symbolic link — removing through it would reach outside ${out}.\n` +
          '  Remove the link, or point --out at the real directory.\n',
      );
      return 1;
    }
    if (!existsSync(out)) {
      process.stdout.write(`skills: nothing to remove — ${out} does not exist\n`);
      return 0;
    }
    const verdicts = planSkillsUninstall(readSkillFolders(out));
    for (const verdict of verdicts) {
      if (verdict.removed) rmSync(join(out, verdict.directory), { recursive: true, force: true });
      process.stdout.write(
        `  ${verdict.removed ? 'removed' : 'kept   '} ${verdict.directory} — ${verdict.why}\n`,
      );
    }
    const removed = verdicts.filter((v) => v.removed).length;
    process.stdout.write(
      `skills: removed ${String(removed)}, kept ${String(verdicts.length - removed)} in ${out}\n`,
    );
    return 0;
  }

  const files = projectSkillsPack({
    lenses: LENSES,
    playbooks: allPlaybooks(),
    standards: LENS_STANDARDS,
    version: packageVersion(),
  });
  // A write through a symbolic link lands outside the directory the user
  // named, and a checked-out repository can plant one under its own tree —
  // a pack folder, `out` itself, or a parent like `.claude`. Every target is
  // checked before anything at all is created, so a refusal never leaves a
  // partial pack behind.
  for (const file of files) {
    const planted = symlinkToward(symlinkGuardRoot(out), join(out, ...file.path.split('/')));
    if (planted) {
      process.stderr.write(
        `skills: ${planted} is a symbolic link — writing through it would land outside ${out}.\n` +
          '  Remove the link, or point --out at the real directory.\n',
      );
      return 1;
    }
  }
  for (const file of files) {
    const target = join(out, ...file.path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
    process.stdout.write(`  wrote ${file.path}\n`);
  }
  process.stdout.write(
    `skills: ${String(files.length)} skill(s) written to ${out}, stamped ${packageVersion()}\n` +
      '  Remove them with: construct skills --uninstall\n',
  );
  return 0;
}
