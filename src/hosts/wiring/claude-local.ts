/**
 * hosts/wiring/claude-local.ts — the one writer of a checkout's machine-local
 * Claude Code settings, `.claude/settings.local.json`, and of the launcher
 * file every Construct hook runs through.
 *
 * Two sets of Construct hooks can live in that file. The grounding hooks,
 * which init installs with Claude Code, record what a tool read, send an
 * unchecked answer back once, and note at session start what waits. The
 * coordination pack, which `construct hooks install --host=claude-code`
 * adds, says who else works here and whether an edited file is reserved.
 * One inventory record in the project's state directory says which sets are
 * in the file, what the file held before Construct first wrote it, and which
 * ignore line keeps it out of git. Removing one set leaves the others in
 * place, and the file stays ignored while any set remains; only when none
 * remains is the file put back as it was and the ignore line taken out.
 * Hooks already in the file stay, and a file that is not a JSON settings
 * object, or that git tracks, is never rewritten.
 *
 * Every hook finds Node and Construct through the launcher file in the
 * project's state directory, never through PATH, which hooks run without on
 * many hosts, and every hook exits 0 whatever happens.
 */

import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { LAUNCHER } from './clients.ts';

/** The machine-local settings file, relative to a checkout. */
export const CLAUDE_LOCAL_SETTINGS_PATH = join('.claude', 'settings.local.json');

/** The sets of Construct hooks the file can hold, in the order they are written. */
export const HOOK_SETS = ['grounding', 'coordination'] as const;
export type HookSet = (typeof HOOK_SETS)[number];

/** A settings file Construct will not edit, with what the person can do about it. */
export class SettingsFileError extends Error {
  readonly next: string | null;

  constructor(message: string, next: string | null = null) {
    super(message);
    this.name = 'SettingsFileError';
    this.next = next;
  }
}

/** What Construct wrote into one machine-local settings file. */
export interface ClaudeLocalRecord {
  readonly host: 'claude-code';
  /** The settings file the hooks went into. */
  readonly file: string;
  /** The sets of Construct hooks the file holds now. */
  readonly sets?: readonly HookSet[];
  /** What the file held before Construct first wrote it, or null when there was none. */
  readonly original: string | null;
  /** What Construct wrote last. */
  readonly written: string;
  /** The ignore file Construct added the settings file to, with what it held before. */
  readonly exclude: { readonly file: string; readonly original: string | null } | null;
  readonly installedAt: string;
}

/** What Construct installed for a project, kept in its state directory. */
export interface Inventory {
  /** Machine-local settings files, by path. */
  readonly packs?: Readonly<Record<string, ClaudeLocalRecord>>;
  readonly [other: string]: unknown;
}

function inventoryPath(stateDir: string): string {
  return join(stateDir, 'installed.json');
}

export function readInventory(stateDir: string): Inventory {
  try {
    return JSON.parse(readFileSync(inventoryPath(stateDir), 'utf8')) as Inventory;
  } catch {
    return {};
  }
}

export function writeInventory(stateDir: string, inv: Inventory): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(inventoryPath(stateDir), `${JSON.stringify(inv, null, 2)}\n`, { mode: 0o600 });
}

/** The sets a record holds. A record without the field holds the coordination pack alone. */
export function setsOf(record: ClaudeLocalRecord | undefined): readonly HookSet[] {
  if (!record) return [];
  return record.sets ?? ['coordination'];
}

/** Run git in `cwd` with this environment. */
export function git(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv): { ok: boolean; out: string; status: number | null } {
  const r = spawnSync('git', [...args], { cwd, env, encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}`.trim(), status: r.status };
}

/** The machine-local file hooks read to find Node and Construct without PATH. */
export function launcherFile(stateDir: string): string {
  return join(stateDir, 'launcher');
}

/** Record this Node and this Construct as what hooks run. */
export function writeLauncher(stateDir: string): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(launcherFile(stateDir), `${process.execPath}\n${LAUNCHER}\n`, { mode: 0o600 });
}

/**
 * Point installed hooks at this Node and this Construct, when hooks are
 * installed and point elsewhere: a host that serves the project is the build
 * its hooks should run. Best effort.
 */
export function refreshLauncher(stateDir: string): void {
  try {
    const file = launcherFile(stateDir);
    if (!existsSync(file)) return;
    if (readFileSync(file, 'utf8') !== `${process.execPath}\n${LAUNCHER}\n`) writeLauncher(stateDir);
  } catch {
    // Hooks keep the launcher they had.
  }
}

/** Why the launcher cannot start Construct, or null when it can. A hook whose launcher cannot does nothing at all. */
export function launcherProblem(stateDir: string): string | null {
  const file = launcherFile(stateDir);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return `the launcher ${file} is missing, so the hooks cannot find Node`;
  }
  const [node = '', construct = ''] = text.split('\n');
  const usable = (path: string, mode: number): boolean => {
    try {
      accessSync(path, mode);
      return true;
    } catch {
      return false;
    }
  };
  if (!node || !usable(node, constants.X_OK)) return `the launcher names ${node || 'no Node'}, which no longer exists here`;
  if (!construct || !usable(construct, constants.R_OK)) return `the launcher names ${construct || 'no Construct'}, which no longer exists here`;
  return null;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The command a host hook runs: a shell line that reads the launcher, does
 * nothing when it is missing or names a Node or Construct that is gone, runs
 * `construct <args>` with the host's event on stdin, and exits 0 whatever
 * happens. CONSTRUCT_HOOKS=off silences it.
 */
export function launcherCommand(stateDir: string, args: readonly string[]): string {
  const word = (s: string) => (/^[\w./:@=,+-]+$/.test(s) ? s : shellQuote(s));
  const script = [
    `l=${shellQuote(launcherFile(stateDir))}`,
    '[ "${CONSTRUCT_HOOKS:-}" = off ] && exit 0',
    '[ -r "$l" ] || exit 0',
    '{ IFS= read -r n; IFS= read -r c; } < "$l"',
    '[ -x "$n" ] && [ -r "$c" ] || exit 0',
    `"$n" "$c" ${args.map(word).join(' ')} 2>/dev/null`,
    'exit 0',
  ].join('; ');
  return `/bin/sh -c ${shellQuote(script)}`;
}

/** The coordination pack's command for one host event. */
function hostHookCommand(stateDir: string, host: 'claude-code', event: 'session-start' | 'post-tool-use'): string {
  return launcherCommand(stateDir, ['hook', host, event]);
}

/** Claude Code event → Construct grounding hook event, with the tool matcher for tool events. */
export const GROUNDING_HOOKS: readonly { readonly hostEvent: string; readonly event: string; readonly matcher?: string }[] = [
  // Every tool: a Jira read can come from any connector's tool name. The handler ignores Construct's own tools.
  { hostEvent: 'PostToolUse', event: 'post-tool', matcher: '*' },
  { hostEvent: 'Stop', event: 'stop' },
  { hostEvent: 'SessionStart', event: 'session-start' },
];

/** What marks a hook command as one of a set's. */
const MARKERS: Readonly<Record<HookSet, RegExp>> = {
  grounding: / hook (?:post-tool|stop|session-start) --client=claude-code/,
  coordination: / hook claude-code (?:session-start|post-tool-use)/,
};

/** True when a hook command is one of this set's. */
export function isSetCommand(command: string, set: HookSet): boolean {
  return MARKERS[set].test(command);
}

/** True when this settings text holds any hook of this set. */
export function holdsSet(text: string, set: HookSet): boolean {
  return MARKERS[set].test(text);
}

type HookEntry = { readonly matcher?: string; readonly hooks?: readonly { readonly type?: string; readonly command?: unknown }[] };

/** True when a settings hook entry is one of this set's. */
export function isSetEntry(entry: unknown, set: HookSet): boolean {
  const hooks = (entry as HookEntry | null)?.hooks;
  return Array.isArray(hooks) && hooks.some((h) => typeof h?.command === 'string' && isSetCommand(h.command, set));
}

/** The entries one set adds, by Claude Code event, exactly as Construct writes them. */
export function hookEntries(set: HookSet, stateDir: string): readonly { readonly hostEvent: string; readonly entry: Record<string, unknown> }[] {
  if (set === 'coordination') {
    return [
      { hostEvent: 'SessionStart', entry: { hooks: [{ type: 'command', command: hostHookCommand(stateDir, 'claude-code', 'session-start'), timeout: 5 }] } },
      { hostEvent: 'PostToolUse', entry: { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: hostHookCommand(stateDir, 'claude-code', 'post-tool-use'), timeout: 5 }] } },
    ];
  }
  return GROUNDING_HOOKS.map((h) => ({
    hostEvent: h.hostEvent,
    entry: { ...(h.matcher ? { matcher: h.matcher } : {}), hooks: [{ type: 'command', command: launcherCommand(stateDir, ['hook', h.event, '--client=claude-code']), timeout: 20 }] },
  }));
}

function withoutSets(settings: Record<string, unknown>, sets: readonly HookSet[]): Record<string, unknown> {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return settings;
  const kept: Record<string, unknown> = {};
  for (const [event, list] of Object.entries(hooks as Record<string, unknown>)) {
    const rest = Array.isArray(list) ? list.filter((e) => !sets.some((s) => isSetEntry(e, s))) : list;
    if (!Array.isArray(rest) || rest.length > 0) kept[event] = rest;
  }
  const { hooks: _dropped, ...others } = settings;
  return Object.keys(kept).length > 0 ? { ...others, hooks: kept } : others;
}

function withSets(settings: Record<string, unknown>, stateDir: string, sets: readonly HookSet[]): Record<string, unknown> {
  const base = withoutSets(settings, sets);
  const hooks = { ...((base.hooks as Record<string, unknown> | undefined) ?? {}) };
  for (const set of HOOK_SETS.filter((s) => sets.includes(s))) {
    for (const { hostEvent, entry } of hookEntries(set, stateDir)) {
      hooks[hostEvent] = [...(Array.isArray(hooks[hostEvent]) ? (hooks[hostEvent] as unknown[]) : []), entry];
    }
  }
  return { ...base, hooks };
}

/** A settings file's object, or a refusal naming why Construct will not edit it. */
export function parseSettings(file: string, text: string | null): Record<string, unknown> {
  if (text === null || !text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SettingsFileError(`${file} is not valid JSON, so Construct will not edit it`, 'Fix the file (Claude Code reads it as JSON), then install again.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SettingsFileError(`${file} does not hold a settings object`);
  const hooks = (parsed as { hooks?: unknown }).hooks;
  if (hooks !== undefined && (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks))) throw new SettingsFileError(`the hooks in ${file} are not an object, so Construct will not edit them`);
  return parsed as Record<string, unknown>;
}

const EXCLUDE_LINES = (relPath: string) => `# Construct hook pack: machine-local host settings\n/${relPath}\n`;

/** True when git tracks this file in the checkout, so whatever is written there is committed. */
function trackedByGit(checkout: string, relPath: string, env: NodeJS.ProcessEnv): boolean {
  return git(checkout, ['ls-files', '--error-unmatch', '--', relPath], env).status === 0;
}

/** Keep a machine-local settings file out of git when nothing ignores it yet. */
function excludeFromGit(checkout: string, relPath: string, env: NodeJS.ProcessEnv): ClaudeLocalRecord['exclude'] {
  if (git(checkout, ['check-ignore', '-q', '--', relPath], env).status !== 1) return null;
  const infoExclude = git(checkout, ['rev-parse', '--git-path', 'info/exclude'], env);
  if (!infoExclude.ok || !infoExclude.out) return null;
  const file = isAbsolute(infoExclude.out) ? infoExclude.out : resolve(checkout, infoExclude.out);
  const original = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const prefix = original === null || original === '' || original.endsWith('\n') ? original ?? '' : `${original}\n`;
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${prefix}${EXCLUDE_LINES(relPath)}`);
  return { file, original };
}

/**
 * Add one set of hooks to the checkout's machine-local settings, keeping the
 * sets already there and rewriting Construct's entries whenever what it would
 * write now differs. Throws SettingsFileError for a file it will not edit,
 * including one git tracks: hooks written there would be committed.
 */
export function installClaudeLocal(checkout: string, stateDir: string, env: NodeJS.ProcessEnv, at: string, set: HookSet): { record: ClaudeLocalRecord; changed: boolean } {
  const file = join(checkout, CLAUDE_LOCAL_SETTINGS_PATH);
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const settings = parseSettings(file, current);
  if (trackedByGit(checkout, CLAUDE_LOCAL_SETTINGS_PATH, env)) {
    throw new SettingsFileError(
      `${file} is tracked by git, so hooks written there would be committed; Construct will not edit it`,
      'Stop tracking it with `git rm --cached .claude/settings.local.json` (your copy stays), then install again.',
    );
  }
  const inv = readInventory(stateDir);
  const prior = inv.packs?.[file];
  const had = setsOf(prior);
  const sets = HOOK_SETS.filter((s) => s === set || had.includes(s));
  const written = `${JSON.stringify(withSets(settings, stateDir, sets), null, 2)}\n`;
  writeLauncher(stateDir);
  if (prior && current === written && had.length === sets.length) return { record: prior, changed: false };
  mkdirSync(dirname(file), { recursive: true });
  const exclude = prior?.exclude ?? excludeFromGit(checkout, CLAUDE_LOCAL_SETTINGS_PATH, env);
  if (current !== written) writeFileSync(file, written);
  // A rewrite over Construct's own earlier write keeps the file's first original.
  const original = prior && current !== null && HOOK_SETS.some((s) => holdsSet(current, s)) ? prior.original : current;
  const record: ClaudeLocalRecord = { host: 'claude-code', file, sets, original, written, exclude, installedAt: at };
  writeInventory(stateDir, { ...inv, packs: { ...(inv.packs ?? {}), [file]: record } });
  return { record, changed: true };
}

const SET_NAMES: Readonly<Record<HookSet, { readonly name: string; readonly none: string; readonly since: string }>> = {
  coordination: { name: 'the claude-code hook pack', none: 'no host hook pack is installed in this checkout', since: 'the pack was installed' },
  grounding: { name: 'the grounding hooks', none: 'no grounding hooks are installed in this checkout', since: 'the grounding hooks were installed' },
};

/**
 * True when putting back what the file held before would lose nothing but
 * Construct's hooks: what Construct last wrote, without its hooks, is what
 * the file held before. A change someone made between two of Construct's
 * writes is kept by removing only Construct's entries instead.
 */
function restorable(file: string, record: ClaudeLocalRecord): boolean {
  try {
    return isDeepStrictEqual(withoutSets(parseSettings(file, record.written), HOOK_SETS), parseSettings(file, record.original));
  } catch {
    return false;
  }
}

/**
 * Remove one set of hooks from the checkout's machine-local settings. The
 * other sets stay, and so does the ignore line. When no set remains, the file
 * goes back to the exact bytes it held before, or, if it changed since, loses
 * only Construct's entries, and the ignore line comes out. Returns what it did,
 * in plain words.
 */
export function uninstallClaudeLocal(checkout: string, stateDir: string, set: HookSet): string[] {
  const file = join(checkout, CLAUDE_LOCAL_SETTINGS_PATH);
  const inv = readInventory(stateDir);
  const record = inv.packs?.[file];
  if (!record || !setsOf(record).includes(set)) return [SET_NAMES[set].none];
  const remaining = setsOf(record).filter((s) => s !== set);
  const notes: string[] = [];
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (remaining.length > 0) {
    let written = record.written;
    if (current !== null) {
      try {
        written = `${JSON.stringify(withoutSets(parseSettings(file, current), [set]), null, 2)}\n`;
        writeFileSync(file, written);
        notes.push(`${file} keeps ${remaining.map((s) => SET_NAMES[s].name).join(' and ')}${record.exclude ? ', and stays out of git' : ''}`);
      } catch {
        notes.push(`${file} is no longer valid JSON; left as it is, with Construct's hooks still in it`);
      }
    }
    writeInventory(stateDir, { ...inv, packs: { ...(inv.packs ?? {}), [file]: { ...record, sets: remaining, written } } });
    notes.unshift(`removed ${SET_NAMES[set].name}`);
    return notes;
  }
  if (current === record.written && restorable(file, record)) {
    if (record.original === null) rmSync(file);
    else writeFileSync(file, record.original);
    notes.push(`restored ${file} as it was`);
  } else if (current !== null) {
    try {
      writeFileSync(file, `${JSON.stringify(withoutSets(parseSettings(file, current), [set]), null, 2)}\n`);
      notes.push(`${file} changed since ${SET_NAMES[set].since}; removed only Construct's hooks`);
    } catch {
      notes.push(`${file} is no longer valid JSON; left as it is, with Construct's hooks still in it`);
    }
  }
  if (record.exclude) {
    const now = existsSync(record.exclude.file) ? readFileSync(record.exclude.file, 'utf8') : null;
    if (now !== null && now.endsWith(EXCLUDE_LINES(CLAUDE_LOCAL_SETTINGS_PATH))) {
      if (record.exclude.original === null) rmSync(record.exclude.file);
      else writeFileSync(record.exclude.file, record.exclude.original);
    }
  }
  const { [file]: _gone, ...packs } = inv.packs ?? {};
  writeInventory(stateDir, { ...inv, packs });
  notes.unshift(`removed ${SET_NAMES[set].name}`);
  return notes;
}
