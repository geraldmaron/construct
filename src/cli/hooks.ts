/**
 * cli/hooks.ts — opt-in hooks that let Construct speak up where agents work
 * without it: a git pre-commit guard, and a host hook pack.
 *
 * The Claude Code pack adds two hooks to the checkout's machine-local
 * `.claude/settings.local.json`: at session start, who else is working here;
 * after an edit, whether the edited file is reserved by another claimant in
 * this checkout. Neither is a permission hook, neither can block anything,
 * and both always succeed (see cli/hook.ts). The file has one writer,
 * hosts/wiring/claude-local.ts, which also keeps the grounding hooks init
 * installs there: hooks already in the file stay, uninstalling the pack
 * leaves the grounding hooks and the file's place outside git, and with
 * nothing of Construct's left the file goes back byte for byte, or, if it
 * changed since, loses only Construct's entries.
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

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  git,
  holdsSet,
  installClaudeLocal,
  launcherFile,
  readInventory,
  setsOf,
  SettingsFileError,
  uninstallClaudeLocal,
  writeInventory,
  writeLauncher,
  type HookSet,
  type Inventory,
} from '../hosts/wiring/claude-local.ts';
import { boolFlag, type CommandSpec, type ParsedArgs } from './commands.ts';
import { bindProject, createContext, resolveRepository, type CliContext } from './context.ts';
import { esc, say, writeJson, OperationError, UsageError } from './output.ts';

const group = 'Host';

export const HOOK_PACK_HOSTS = ['claude-code'] as const;

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

/** The project's inventory, with the git guard's record. */
type GuardInventory = Inventory & { readonly git?: GitGuardRecord };

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

/** A settings file Construct will not edit, as the error this command exits with. */
function asOperationError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof SettingsFileError) throw new OperationError(error.message, error.next);
    throw error;
  }
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
  const inv = readInventory(stateDir) as GuardInventory;
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
  const inv = readInventory(stateDir) as GuardInventory;
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

/** Whether a set of hooks is still in its settings file as Construct wrote it. */
function setState(file: string, written: string, set: HookSet): 'intact' | 'changed' | 'missing' {
  if (!existsSync(file)) return 'missing';
  const now = readFileSync(file, 'utf8');
  if (now === written) return 'intact';
  return holdsSet(now, set) ? 'changed' : 'missing';
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
        const { record, changed } = asOperationError(() => installClaudeLocal(checkout, stateDir, ctx.env, ctx.now(), 'coordination'));
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
        const notes = uninstallClaudeLocal(checkout, stateDir, 'coordination');
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
      const inv = readInventory(stateDir) as GuardInventory;
      const guard = inv.git ? { ...inv.git, state: gitGuardState(inv.git) } : null;
      // One line per set of hooks in each machine-local settings file: the pack, and the grounding hooks init installs.
      const packs = Object.values(inv.packs ?? {}).flatMap((p) => setsOf(p).map((set) => ({ host: p.host, set, file: p.file, state: setState(p.file, p.written, set) })));
      if (args.json) writeJson({ git: guard, packs });
      else if (!guard && packs.length === 0) say('no hooks installed here');
      else {
        if (guard) say(`git guard  ${guard.state}  ${esc(guard.hook)}${guard.chained ? `  (chains ${esc(guard.chained)})` : ''}`);
        for (const p of packs) say(`${p.host} ${p.set === 'coordination' ? 'pack' : 'grounding hooks'}  ${p.state}  ${esc(p.file)}`);
      }
      return 0;
    }
    default:
      throw new UsageError(`unknown hooks command ${sub}`);
  }
}
