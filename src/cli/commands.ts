/**
 * cli/commands.ts — the command registry: one description of every command,
 * from which the grouped help, per-command help, flag checking, shell
 * completions, and the documentation lint all derive. Nothing else declares
 * what the CLI accepts.
 */

import { UsageError } from './output.ts';

export interface FlagSpec {
  readonly name: string;
  readonly gloss: string;
  /** false: a switch. true: --name=value or --name value. */
  readonly takesValue: boolean;
  readonly repeatable?: boolean;
}

export interface CommandSpec {
  /** ['init'] or ['source', 'add']. */
  readonly path: readonly string[];
  readonly gloss: string;
  readonly group: string;
  readonly positionals: readonly string[];
  readonly flags: readonly FlagSpec[];
  /** Reads only; never changes files or state. */
  readonly readOnly: boolean;
}

export const GLOBAL_FLAGS: readonly FlagSpec[] = Object.freeze([
  { name: 'json', gloss: 'print the record as one line of JSON instead of prose', takesValue: false },
  { name: 'debug', gloss: 'include stack traces in failures', takesValue: false },
  { name: 'help', gloss: 'show this command’s help', takesValue: false },
]);

export type FlagValue = true | string | readonly string[];

export interface ParsedArgs {
  readonly flags: Readonly<Record<string, FlagValue>>;
  readonly positionals: readonly string[];
  readonly json: boolean;
  readonly debug: boolean;
  readonly help: boolean;
}

export function commandName(spec: CommandSpec): string {
  return spec.path.join(' ');
}

export function commandHelp(spec: CommandSpec): string {
  const usage = ['construct', ...spec.path, ...spec.positionals, ...spec.flags.map((f) => `[--${f.name}${f.takesValue ? '=<value>' : ''}]`)].join(' ');
  const lines = [`${usage}`, `  ${spec.gloss}`];
  const flags = [...spec.flags, ...GLOBAL_FLAGS];
  if (flags.length > 0) {
    lines.push('  flags:');
    const width = Math.max(...flags.map((f) => f.name.length));
    for (const f of flags) lines.push(`    --${f.name.padEnd(width)}  ${f.gloss}${f.repeatable ? ' (repeatable)' : ''}`);
  }
  return `${lines.join('\n')}\n`;
}

export function groupedHelp(commands: readonly CommandSpec[], groups: readonly string[], intro: readonly string[]): string {
  const width = Math.max(...commands.map((c) => commandName(c).length));
  const lines = [...intro, ''];
  for (const group of groups) {
    const members = commands.filter((c) => c.group === group);
    if (members.length === 0) continue;
    lines.push(group);
    for (const c of members) lines.push(`  ${commandName(c).padEnd(width)}  ${c.gloss}`);
    lines.push('');
  }
  lines.push('One command in depth: construct <command> --help');
  return `${lines.join('\n')}\n`;
}

/**
 * Match argv against the registry: the longest command path that prefixes
 * argv wins. Returns the spec and the remaining arguments.
 */
export function matchCommand(
  commands: readonly CommandSpec[],
  argv: readonly string[],
): { readonly spec: CommandSpec; readonly rest: readonly string[] } | null {
  let best: CommandSpec | null = null;
  for (const spec of commands) {
    if (spec.path.length > argv.length) continue;
    if (spec.path.every((word, i) => argv[i] === word) && (!best || spec.path.length > best.path.length)) best = spec;
  }
  return best ? { spec: best, rest: argv.slice(best.path.length) } : null;
}

/** Parse flags and positionals for one command. Unknown flags are refused. */
export function parseArgs(spec: CommandSpec, argv: readonly string[]): ParsedArgs {
  const known = new Map<string, FlagSpec>();
  for (const f of [...spec.flags, ...GLOBAL_FLAGS]) known.set(f.name, f);
  const flags: Record<string, FlagValue> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '-h') {
      flags.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const f = known.get(name);
    if (!f) throw new UsageError(`unknown flag --${name}`, commandHelp(spec));
    if (!f.takesValue) {
      if (eq !== -1) throw new UsageError(`--${name} takes no value`, commandHelp(spec));
      flags[name] = true;
      continue;
    }
    let value: string;
    if (eq !== -1) {
      value = arg.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) {
      value = argv[i + 1]!;
      i += 1;
    } else {
      throw new UsageError(`--${name} needs a value`, commandHelp(spec));
    }
    if (f.repeatable) {
      const prior = flags[name];
      flags[name] = Array.isArray(prior) ? [...prior, value] : [value];
    } else {
      flags[name] = value;
    }
  }
  const required = spec.positionals.filter((p) => p.startsWith('<'));
  if (positionals.length < required.length && flags.help !== true) {
    throw new UsageError(`missing ${required.slice(positionals.length).join(' ')}`, commandHelp(spec));
  }
  return {
    flags,
    positionals,
    json: flags.json === true,
    debug: flags.debug === true || process.env.CONSTRUCT_DEBUG === '1',
    help: flags.help === true,
  };
}

export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const v = args.flags[name];
  return typeof v === 'string' ? v : undefined;
}

export function listFlag(args: ParsedArgs, name: string): readonly string[] {
  const v = args.flags[name];
  if (Array.isArray(v)) return v;
  return typeof v === 'string' ? [v] : [];
}

export function boolFlag(args: ParsedArgs, name: string): boolean {
  return args.flags[name] === true;
}
