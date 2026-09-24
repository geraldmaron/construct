/**
 * cli/hooks.ts — opt-in hooks that let Construct speak up where agents work
 * without it: a git pre-commit guard, and a host hook pack.
 *
 * The Claude Code pack adds two hooks to the checkout's machine-local
 * `.claude/settings.local.json`: at session start, who else is working here;
 * after an edit, whether the edited file is reserved by another claimant in
 * this checkout. Neither is a permission hook, neither can block anything,
 * and both always succeed (see cli/hook.ts). Hooks already in the file stay;
 * uninstalling puts the file back byte for byte, or, if it changed since,
 * removes only Construct's entries.
 *
 * The guard runs `construct work check --staged` before each commit and
 * prints a warning when a staged file is reserved by other work in the same
 * checkout. It never blocks a commit and never fails one: anything missing,
 * slow, or broken means it says nothing. It lives in git's hooks directory
 * for this repository, so every worktree gets it. An existing pre-commit hook
 * keeps running after it, renamed beside it; uninstalling restores that hook
 * byte for byte. A hooks directory inside a working tree is committed
 * configuration someone else manages, and Construct does not edit it.
 *
 * The hook finds Node and Construct through a machine-local launcher file in
 * the project's state directory, never through PATH, which git hooks run
 * without on many hosts.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { LAUNCHER } from '../hosts/wiring/clients.ts';
import { boolFlag, type CommandSpec, type ParsedArgs } from './commands.ts';
import { bindProject, createContext, resolveRepository, type CliContext } from './context.ts';
import { esc, say, writeJson, OperationError, UsageError } from './output.ts';

const group = 'Host';

export const HOOK_PACK_HOSTS = ['claude-code'] as const;
export type HookPackHost = (typeof HOOK_PACK_HOSTS)[number];

export const HOOKS_SPECS: readonly CommandSpec[] = [
  { path: ['hooks', 'install'], gloss: 'install an opt-in hook: --git adds a pre-commit guard; --host=claude-code adds session-start and after-edit notes', group, positionals: [], flags: [
    { name: 'git', gloss: 'the git pre-commit guard (warns, never blocks)', takesValue: false },
    { name: 'host', gloss: `a host hook pack for this checkout: ${HOOK_PACK_HOSTS.join(' | ')}`, takesValue: true },
  ], readOnly: false },
  { path: ['hooks', 'uninstall'], gloss: 'remove a hook Construct installed, restoring what was there', group, positionals: [], flags: [
    { name: 'git', gloss: 'the git pre-commit guard', takesValue: false },
    { name: 'host', gloss: `the host hook pack for this checkout: ${HOOK_PACK_HOSTS.join(' | ')}`, takesValue: true },
  ], readOnly: false },
  { path: ['hooks', 'list'], gloss: 'the hooks Construct installed here, and whether each is intact', group, positionals: [], flags: [], readOnly: true },
];

/** The file beside the pre-commit guard that holds the hook it replaced. */
export const CHAINED_SUFFIX = '.construct-chained';
const GUARD_MARKER = '# construct-git-guard';

interface GitGuardRecord {
  readonly hooksDir: string;
  readonly hook: string;
  readonly sha256: string;
  /** The hook that was there before, now renamed beside the guard; null when there was none. */
  readonly chained: string | null;
  readonly installedAt: string;
}

interface HostPackRecord {
  readonly host: HookPackHost;
  /** The settings file the pack went into. */
  readonly file: string;
  /** What the file held before, or null when there was none. */
  readonly original: string | null;
  /** What Construct wrote. */
  readonly written: string;
  /** The ignore file Construct added the settings file to, with what it held before. */
  readonly exclude: { readonly file: string; readonly original: string | null } | null;
  readonly installedAt: string;
}

interface Inventory {
  readonly git?: GitGuardRecord;
  /** Host hook packs, by the settings file each went into. */
  readonly packs?: Readonly<Record<string, HostPackRecord>>;
}

function inventoryPath(stateDir: string): string {
  return join(stateDir, 'installed.json');
}

function readInventory(stateDir: string): Inventory {
  try {
    return JSON.parse(readFileSync(inventoryPath(stateDir), 'utf8')) as Inventory;
  } catch {
    return {};
  }
}

function writeInventory(stateDir: string, inv: Inventory): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(inventoryPath(stateDir), `${JSON.stringify(inv, null, 2)}\n`, { mode: 0o600 });
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

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The pre-commit guard for the project whose state lives in `stateDir`. */
export function gitGuardScript(stateDir: string): string {
  return [
    '#!/bin/sh',
    GUARD_MARKER,
    '# Installed by `construct hooks install --git`. Warns when staged files are',
    '# reserved by other work in this checkout; never blocks a commit.',
    '# `construct hooks uninstall --git` restores what was here before.',
    `launcher=${shellQuote(launcherFile(stateDir))}`,
    'if [ "${CONSTRUCT_HOOKS:-}" != "off" ] && [ -r "$launcher" ]; then',
    '  { IFS= read -r node; IFS= read -r construct; } < "$launcher"',
    '  if [ -x "$node" ] && [ -r "$construct" ]; then',
    '    report=$("$node" "$construct" work check --staged 2>&1) || printf \'construct: %s\\n\' "$report" >&2',
    '  fi',
    'fi',
    `chained="$(dirname "$0")/pre-commit${CHAINED_SUFFIX}"`,
    'if [ -x "$chained" ]; then exec "$chained" "$@"; fi',
    'exit 0',
    '',
  ].join('\n');
}

function git(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv): { ok: boolean; out: string; status: number | null } {
  const r = spawnSync('git', [...args], { cwd, env, encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}`.trim(), status: r.status };
}

/**
 * The command a host hook runs: a shell line that finds Node and Construct
 * through the launcher file, not PATH, and succeeds whatever happens.
 */
export function hostHookCommand(stateDir: string, host: HookPackHost, event: 'session-start' | 'post-tool-use'): string {
  const script = [
    `l=${shellQuote(launcherFile(stateDir))}`,
    '[ "${CONSTRUCT_HOOKS:-}" = off ] && exit 0',
    '[ -r "$l" ] || exit 0',
    '{ IFS= read -r n; IFS= read -r c; } < "$l"',
    '[ -x "$n" ] && [ -r "$c" ] || exit 0',
    `"$n" "$c" hook ${host} ${event} 2>/dev/null`,
    'exit 0',
  ].join('; ');
  return `/bin/sh -c ${shellQuote(script)}`;
}

const PACK_MARKER = / hook claude-code (?:session-start|post-tool-use)/;

type HookEntry = { readonly matcher?: string; readonly hooks?: readonly { readonly type?: string; readonly command?: unknown }[] };

function isPackEntry(entry: unknown): boolean {
  const hooks = (entry as HookEntry | null)?.hooks;
  return Array.isArray(hooks) && hooks.some((h) => typeof h?.command === 'string' && PACK_MARKER.test(h.command));
}

function withoutPack(settings: Record<string, unknown>): Record<string, unknown> {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return settings;
  const kept: Record<string, unknown> = {};
  for (const [event, list] of Object.entries(hooks as Record<string, unknown>)) {
    const rest = Array.isArray(list) ? list.filter((e) => !isPackEntry(e)) : list;
    if (!Array.isArray(rest) || rest.length > 0) kept[event] = rest;
  }
  const { hooks: _dropped, ...others } = settings;
  return Object.keys(kept).length > 0 ? { ...others, hooks: kept } : others;
}

function withPack(settings: Record<string, unknown>, stateDir: string): Record<string, unknown> {
  const base = withoutPack(settings);
  const hooks = { ...((base.hooks as Record<string, unknown> | undefined) ?? {}) };
  const add = (event: string, entry: Record<string, unknown>): void => {
    hooks[event] = [...(Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : []), entry];
  };
  add('SessionStart', { hooks: [{ type: 'command', command: hostHookCommand(stateDir, 'claude-code', 'session-start'), timeout: 5 }] });
  add('PostToolUse', { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: hostHookCommand(stateDir, 'claude-code', 'post-tool-use'), timeout: 5 }] });
  return { ...base, hooks };
}

function parseSettings(file: string, text: string | null): Record<string, unknown> {
  if (text === null || !text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OperationError(`${file} is not valid JSON, so Construct will not edit it`, 'Fix the file (Claude Code reads it as JSON), then install again.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new OperationError(`${file} does not hold a settings object`);
  const hooks = (parsed as { hooks?: unknown }).hooks;
  if (hooks !== undefined && (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks))) throw new OperationError(`the hooks in ${file} are not an object, so Construct will not edit them`);
  return parsed as Record<string, unknown>;
}

/** Keep a machine-local settings file out of git when nothing ignores it yet. */
function excludeFromGit(checkout: string, relPath: string, env: NodeJS.ProcessEnv): HostPackRecord['exclude'] {
  if (git(checkout, ['check-ignore', '-q', '--', relPath], env).status !== 1) return null;
  const infoExclude = git(checkout, ['rev-parse', '--git-path', 'info/exclude'], env);
  if (!infoExclude.ok || !infoExclude.out) return null;
  const file = isAbsolute(infoExclude.out) ? infoExclude.out : resolve(checkout, infoExclude.out);
  const original = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const prefix = original === null || original === '' || original.endsWith('\n') ? original ?? '' : `${original}\n`;
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${prefix}# Construct hook pack: machine-local host settings\n/${relPath}\n`);
  return { file, original };
}

function installPack(host: HookPackHost, checkout: string, stateDir: string, env: NodeJS.ProcessEnv, at: string): { record: HostPackRecord; changed: boolean } {
  const rel = join('.claude', 'settings.local.json');
  const file = join(checkout, rel);
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const settings = parseSettings(file, current);
  const inv = readInventory(stateDir);
  const prior = inv.packs?.[file];
  const written = `${JSON.stringify(withPack(settings, stateDir), null, 2)}\n`;
  writeLauncher(stateDir);
  if (prior && current === written) return { record: prior, changed: false };
  mkdirSync(join(checkout, '.claude'), { recursive: true });
  const exclude = prior?.exclude ?? excludeFromGit(checkout, rel, env);
  writeFileSync(file, written);
  // A reinstall over Construct's own earlier write keeps the file's first original.
  const original = prior && current !== null && PACK_MARKER.test(current) ? prior.original : current;
  const record: HostPackRecord = { host, file, original, written, exclude, installedAt: at };
  writeInventory(stateDir, { ...inv, packs: { ...(inv.packs ?? {}), [file]: record } });
  return { record, changed: true };
}

function uninstallPack(checkout: string, stateDir: string): string[] {
  const file = join(checkout, '.claude', 'settings.local.json');
  const inv = readInventory(stateDir);
  const record = inv.packs?.[file];
  if (!record) return ['no host hook pack is installed in this checkout'];
  const notes: string[] = [];
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (current === record.written) {
    if (record.original === null) rmSync(file);
    else writeFileSync(file, record.original);
    notes.push(`restored ${file} as it was`);
  } else if (current !== null) {
    try {
      writeFileSync(file, `${JSON.stringify(withoutPack(parseSettings(file, current)), null, 2)}\n`);
      notes.push(`${file} changed since the pack was installed; removed only Construct's hooks`);
    } catch {
      notes.push(`${file} is no longer valid JSON; left as it is, with Construct's hooks still in it`);
    }
  }
  if (record.exclude) {
    const now = existsSync(record.exclude.file) ? readFileSync(record.exclude.file, 'utf8') : null;
    const ours = `# Construct hook pack: machine-local host settings\n/${join('.claude', 'settings.local.json')}\n`;
    if (now !== null && now.endsWith(ours)) {
      if (record.exclude.original === null) rmSync(record.exclude.file);
      else writeFileSync(record.exclude.file, record.exclude.original);
    }
  }
  const { [file]: _gone, ...packs } = inv.packs ?? {};
  writeInventory(stateDir, { ...inv, packs });
  notes.unshift('removed the claude-code hook pack');
  return notes;
}

/** Git's hooks directory for the repository holding `cwd`, honoring core.hooksPath. */
function hooksDirOf(cwd: string, env: NodeJS.ProcessEnv): string {
  const r = git(cwd, ['rev-parse', '--git-path', 'hooks'], env);
  if (!r.ok || !r.out) throw new OperationError('this project is not in a git repository, so there is no commit to guard');
  return isAbsolute(r.out) ? r.out : resolve(cwd, r.out);
}

function installGitGuard(root: string, stateDir: string, env: NodeJS.ProcessEnv, at: string): { record: GitGuardRecord; changed: boolean } {
  const hooksDir = hooksDirOf(root, env);
  if (existsSync(hooksDir) && git(hooksDir, ['rev-parse', '--is-inside-work-tree'], env).out === 'true') {
    throw new OperationError(
      `git runs hooks from ${hooksDir}, inside a working tree: committed configuration another tool or your team manages, which Construct does not edit`,
      'Add `construct work check --staged || true` to that pre-commit hook where it is maintained.',
    );
  }
  mkdirSync(hooksDir, { recursive: true });
  const hook = join(hooksDir, 'pre-commit');
  const chainedPath = `${hook}${CHAINED_SUFFIX}`;
  const script = gitGuardScript(stateDir);
  const inv = readInventory(stateDir);
  writeLauncher(stateDir);
  const current = existsSync(hook) ? readFileSync(hook, 'utf8') : null;
  if (current !== null && current.includes(GUARD_MARKER)) {
    if (current === script && inv.git) return { record: inv.git, changed: false };
    writeFileSync(hook, script, { mode: 0o755 });
    const record: GitGuardRecord = { hooksDir, hook, sha256: sha256(script), chained: existsSync(chainedPath) ? chainedPath : null, installedAt: at };
    writeInventory(stateDir, { ...inv, git: record });
    return { record, changed: true };
  }
  if (current !== null) {
    if (existsSync(chainedPath)) throw new OperationError(`${chainedPath} already exists; move it aside before installing the guard`);
    renameSync(hook, chainedPath);
  }
  writeFileSync(hook, script, { mode: 0o755 });
  chmodSync(hook, 0o755);
  const record: GitGuardRecord = { hooksDir, hook, sha256: sha256(script), chained: current === null ? null : chainedPath, installedAt: at };
  writeInventory(stateDir, { ...inv, git: record });
  return { record, changed: true };
}

function uninstallGitGuard(stateDir: string): string[] {
  const inv = readInventory(stateDir);
  const record = inv.git;
  if (!record) return ['the git guard is not installed here'];
  const notes: string[] = [];
  const current = existsSync(record.hook) ? readFileSync(record.hook, 'utf8') : null;
  const ours = current !== null && sha256(current) === record.sha256;
  if (ours) rmSync(record.hook);
  else if (current !== null) notes.push(`${record.hook} changed since the guard was installed; left as it is`);
  if (record.chained && existsSync(record.chained)) {
    if (ours || current === null) {
      renameSync(record.chained, record.hook);
      notes.push(`restored the earlier pre-commit hook at ${record.hook}`);
    } else notes.push(`the earlier hook is still at ${record.chained}`);
  }
  const { git: _removed, ...rest } = inv;
  writeInventory(stateDir, rest);
  notes.unshift(ours ? 'removed the git guard' : 'forgot the git guard');
  return notes;
}

function gitGuardState(record: GitGuardRecord): 'intact' | 'changed' | 'missing' {
  if (!existsSync(record.hook)) return 'missing';
  return sha256(readFileSync(record.hook, 'utf8')) === record.sha256 && statSync(record.hook).mode & 0o100 ? 'intact' : 'changed';
}

export function hooksCommand(sub: string, args: ParsedArgs, ctx: CliContext = createContext()): number {
  const project = bindProject(ctx);
  const stateDir = project.layout.stateDir;
  const host = args.flags.host as string | undefined;
  if (host !== undefined && !(HOOK_PACK_HOSTS as readonly string[]).includes(host)) {
    throw new UsageError(`--host must be one of ${HOOK_PACK_HOSTS.join(' | ')}; other hosts get a pack once one is verified against them`);
  }
  const checkout = resolveRepository(ctx.cwd)?.checkout ?? project.root;
  switch (sub) {
    case 'install': {
      if (host) {
        const { record, changed } = installPack(host as HookPackHost, checkout, stateDir, ctx.env, ctx.now());
        if (args.json) writeJson({ pack: { host: record.host, file: record.file }, changed });
        else {
          say(changed ? `installed the ${record.host} hook pack in ${esc(record.file)}` : `the ${record.host} hook pack is already installed in ${esc(record.file)}`);
          say('  at session start it says who else works here; after an edit, whether that file is reserved by another agent in this checkout');
          say('  it never blocks anything; set CONSTRUCT_HOOKS=off to silence it; construct hooks uninstall --host=claude-code removes it');
        }
        return 0;
      }
      if (!boolFlag(args, 'git')) throw new UsageError('name the hook to install: --git or --host=claude-code');
      const { record, changed } = installGitGuard(project.root, stateDir, ctx.env, ctx.now());
      if (args.json) writeJson({ git: record, changed });
      else {
        say(changed ? `installed the git guard at ${esc(record.hook)}` : `the git guard is already installed at ${esc(record.hook)}`);
        if (record.chained) say(`  your earlier pre-commit hook runs after it, from ${esc(record.chained)}`);
        say('  it warns when a staged file is reserved by other work in this checkout, and never blocks a commit');
        say('  set CONSTRUCT_HOOKS=off to silence it; construct hooks uninstall --git removes it');
      }
      return 0;
    }
    case 'uninstall': {
      if (host) {
        const notes = uninstallPack(checkout, stateDir);
        if (args.json) writeJson({ notes });
        else for (const n of notes) say(esc(n));
        return 0;
      }
      if (!boolFlag(args, 'git')) throw new UsageError('name the hook to remove: --git or --host=claude-code');
      const notes = uninstallGitGuard(stateDir);
      if (args.json) writeJson({ notes });
      else for (const n of notes) say(esc(n));
      return 0;
    }
    case 'list': {
      const inv = readInventory(stateDir);
      const git = inv.git ? { ...inv.git, state: gitGuardState(inv.git) } : null;
      const packs = Object.values(inv.packs ?? {}).map((p) => ({
        host: p.host,
        file: p.file,
        state: !existsSync(p.file) ? 'missing' : readFileSync(p.file, 'utf8') === p.written ? 'intact' : PACK_MARKER.test(readFileSync(p.file, 'utf8')) ? 'changed' : 'missing',
      }));
      if (args.json) writeJson({ git, packs });
      else if (!git && packs.length === 0) say('no hooks installed here');
      else {
        if (git) say(`git guard  ${git.state}  ${esc(git.hook)}${git.chained ? `  (chains ${esc(git.chained)})` : ''}`);
        for (const p of packs) say(`${p.host} pack  ${p.state}  ${esc(p.file)}`);
      }
      return 0;
    }
    default:
      throw new UsageError(`unknown hooks command ${sub}`);
  }
}
