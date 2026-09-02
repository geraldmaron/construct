/**
 * cli/index.ts — the command line: setup, inspection, automation, recovery.
 *
 * One registry describes every command; help, completions, flag checking, and
 * the documentation lint read it. Ordinary use of Construct is conversational
 * in the agent host; this surface is for setting up, looking, scripting, and
 * recovering. Exit codes: 0 done, 1 could not complete, 2 the command line was
 * wrong.
 */

import { readFileSync } from 'node:fs';
import { commandHelp, groupedHelp, matchCommand, parseArgs, type CommandSpec, type ParsedArgs } from './commands.ts';
import { createContext, type CliContext } from './context.ts';
import { reportFailure, say, warn, UsageError } from './output.ts';
import { init, INIT_SPEC } from './init.ts';
import { status, STATUS_SPEC } from './status.ts';
import { doctor, DOCTOR_SPEC } from './doctor.ts';
import { reset, RESET_SPEC } from './reset.ts';
import { configCommand, CONFIG_SPECS } from './config.ts';
import { projectCommand, PROJECT_SPECS } from './project.ts';
import { sourceCommand, SOURCE_SPECS } from './source.ts';
import { skillCommand, SKILL_SPECS } from './skill.ts';
import { completionScript, SHELLS, type Shell } from './completions.ts';

export const VERSION_SPEC: CommandSpec = { path: ['version'], gloss: 'print the installed version', group: 'Help', positionals: [], flags: [], readOnly: true };
export const HELP_SPEC: CommandSpec = { path: ['help'], gloss: 'show every command', group: 'Help', positionals: [], flags: [], readOnly: true };
export const COMPLETION_SPEC: CommandSpec = {
  path: ['completion'],
  gloss: 'print a shell completion script derived from this command list',
  group: 'Help',
  positionals: [],
  flags: [{ name: 'shell', gloss: `one of ${SHELLS.join(' | ')} (default bash)`, takesValue: true }],
  readOnly: true,
};

/** Every command, in help order. The single source for help, completions, and the docs lint. */
export const COMMANDS: readonly CommandSpec[] = Object.freeze([
  INIT_SPEC,
  ...PROJECT_SPECS.filter((s) => s.group === 'Setup'),
  STATUS_SPEC,
  DOCTOR_SPEC,
  ...PROJECT_SPECS.filter((s) => s.group !== 'Setup'),
  ...CONFIG_SPECS,
  ...SOURCE_SPECS,
  ...SKILL_SPECS,
  RESET_SPEC,
  COMPLETION_SPEC,
  VERSION_SPEC,
  HELP_SPEC,
]);

export const HELP_GROUPS: readonly string[] = Object.freeze(['Setup', 'Inspect', 'Configure', 'Sources', 'Skills', 'Recover', 'Help']);

const INTRO: readonly string[] = [
  'construct — a project-bound operating layer for the agent host you already use.',
  '',
  'Start here: construct init',
  '  Then talk in your agent session. This command line is for setup,',
  '  inspection, scripting, and recovery; the work itself happens in the host.',
];

/** Every command name as typed, one per line, for tooling. */
export function commandNames(): readonly string[] {
  return COMMANDS.map((c) => c.path.join(' '));
}

export function packageVersion(): string {
  const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
  return (JSON.parse(raw) as { version: string }).version;
}

export async function main(argv: string[] = process.argv.slice(2), ctx: CliContext = createContext()): Promise<number> {
  const quitOnClosedOutput = (error: NodeJS.ErrnoException): void => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
  };
  process.stdout.on('error', quitOnClosedOutput);
  process.stderr.on('error', quitOnClosedOutput);
  return run(argv, ctx);
}

export async function run(argv: readonly string[], ctx: CliContext = createContext()): Promise<number> {
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(groupedHelp(COMMANDS, HELP_GROUPS, INTRO));
    return 0;
  }
  if (argv[0] === '--version' || argv[0] === '-v') {
    say(packageVersion());
    return 0;
  }
  const matched = matchCommand(COMMANDS, argv);
  if (!matched) {
    const known = COMMANDS.filter((c) => c.path[0] === argv[0]);
    if (known.length > 0 && known.every((c) => c.path.length > 1)) {
      const asked = argv[1];
      warn(`construct ${argv[0]!}: ${asked !== undefined && !asked.startsWith('-') ? `no subcommand "${asked}"` : 'needs a subcommand'}: ${known.map((c) => c.path[1]).join(' | ')}`);
      return 2;
    }
    warn(`construct: unknown command ${JSON.stringify(argv[0])}`);
    process.stdout.write(groupedHelp(COMMANDS, HELP_GROUPS, INTRO));
    return 2;
  }
  const { spec, rest } = matched;
  const name = spec.path.join(' ');
  let args: ParsedArgs;
  try {
    args = parseArgs(spec, rest);
  } catch (error) {
    return reportFailure(name, error, false);
  }
  if (args.help) {
    process.stdout.write(commandHelp(spec));
    return 0;
  }
  try {
    return await dispatch(spec, args, rest, ctx);
  } catch (error) {
    return reportFailure(name, error, args.debug);
  }
}

async function dispatch(spec: CommandSpec, args: ParsedArgs, rest: readonly string[], ctx: CliContext): Promise<number> {
  const [noun, verb] = spec.path;
  switch (noun) {
    case 'init':
      return init(args, ctx);
    case 'status':
      return status(args, ctx);
    case 'doctor':
      return doctor(args, ctx);
    case 'reset':
      return reset(args, ctx);
    case 'config':
      return configCommand(verb!, args, rest, ctx);
    case 'project':
      return projectCommand(verb!, args, ctx);
    case 'source':
      return sourceCommand(verb!, args, ctx);
    case 'skill':
      return skillCommand(verb!, args, ctx);
    case 'completion': {
      const shell = (args.flags.shell as string | undefined) ?? 'bash';
      if (!(SHELLS as readonly string[]).includes(shell)) throw new UsageError(`--shell must be one of ${SHELLS.join(' | ')}`);
      process.stdout.write(completionScript(shell as Shell, COMMANDS));
      return 0;
    }
    case 'version':
      say(packageVersion());
      return 0;
    default:
      throw new UsageError(`unknown command ${noun!}`);
  }
}
