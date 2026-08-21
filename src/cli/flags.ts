/**
 * cli/flags.ts — turning argv into the few shapes every verb reads.
 *
 * One place, because the surfaces have to agree: a `--workspace` that defaults
 * differently on two commands files one client's sources under another, and a
 * `--timeout` accepted here and ignored there is a flag that lies.
 */

import { HOST_NAMES } from './runtime.ts';
import type { HostName } from './runtime.ts';

/** Split `--key=value` flags from positional words, in argv order. */
export function splitFlags(argv: string[]): { flags: Record<string, string>; words: string[] } {
  const flags: Record<string, string> = {};
  const words: string[] = [];
  for (const arg of argv) {
    const valued = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (valued) {
      flags[valued[1]] = valued[2];
      continue;
    }
    // A flag carrying no value is present, not absent, and not a positional.
    // Every surface that documents one — --no-close, --record — tests it with
    // `!== undefined`, so the empty string is the right value; the alternative
    // was that a bare flag fell through to `words` and was read as whatever
    // positional came first, which for compose is the run id.
    const bare = /^--([a-z-]+)$/.exec(arg);
    if (bare) flags[bare[1]] = '';
    else words.push(arg);
  }
  return { flags, words };
}

export function parseFlags(argv: string[]): { flags: Record<string, string>; rest: string[] } {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (match) flags[match[1]] = match[2] ?? 'true';
    else rest.push(arg);
  }
  return { flags, rest };
}

/**
 * Sources and mode default to the "default" workspace rather than inferring
 * one from the directory: an inferred workspace that guessed wrong would file
 * one client's sources under another, which is the exact failure the lesson
 * store was rebuilt to make unrepresentable. Naming a workspace is cheap;
 * un-crossing two is not.
 */
export function workspaceFlag(flags: Record<string, string>): string {
  return flags.workspace?.trim() || 'default';
}

/**
 * `--timeout=<minutes>`, in milliseconds, or undefined for the host's own
 * declared default.
 *
 * Stated in minutes because the wall a user hits is measured in minutes of
 * their afternoon, and taken as a flag because the alternative — one constant
 * for every model — makes a 4b model and a 120b model wait the same, which is
 * a limit nobody measured either way.
 */
export function timeoutFlag(flags: Record<string, string>): number | undefined {
  if (flags.timeout === undefined) return undefined;
  const minutes = Number(flags.timeout);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error(`--timeout must be a positive number of minutes, got "${flags.timeout}"`);
  }
  return minutes * 60 * 1000;
}

export interface HostFlags {
  readonly host?: HostName;
  readonly model?: string;
  readonly binary?: string;
  readonly dir?: string;
  readonly timeoutMs?: number;
}

/**
 * The host selection every model-calling surface takes, parsed once. A host
 * tuning flag with no host named is refused rather than ignored: silently
 * dropping `--model` on a surface that was never going to call a model is how
 * a user comes to believe a model ran.
 */
export function parseHostFlags(flags: Record<string, string>): HostFlags {
  const host = flags.host;
  if (host !== undefined && !(HOST_NAMES as readonly string[]).includes(host)) {
    throw new Error(`unknown host "${host}" (expected ${HOST_NAMES.join(', ')})`);
  }
  const named = ['model', 'binary', 'dir', 'timeout'].filter((f) => flags[f] !== undefined);
  if (host === undefined && named.length > 0) {
    throw new Error(
      `--${named[0]} only applies when a host is named; add --host=<opencode|claude|codex|cursor>, or drop the flag`,
    );
  }
  return {
    host: host as HostName | undefined,
    model: flags.model,
    binary: flags.binary,
    dir: flags.dir,
    ...(timeoutFlag(flags) === undefined ? {} : { timeoutMs: timeoutFlag(flags) }),
  };
}

/** A comma-separated flag value as the list it names, blanks dropped. */
export function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
