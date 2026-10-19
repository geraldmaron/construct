/**
 * hosts/wiring/hooks.ts — Construct's grounding hooks for Claude Code: put
 * them in the checkout's machine-local settings and say whether they are
 * there and current.
 *
 * The hooks live in .claude/settings.local.json, which stays on this machine
 * and out of git, and find Node and Construct through the launcher in the
 * project's state directory, so no file a team commits names a path on this
 * machine. claude-local.ts is that file's one writer. Construct never writes
 * .claude/settings.json, the shared file; a team may commit portable hooks
 * there, and those count as installed.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  CLAUDE_LOCAL_SETTINGS_PATH,
  GROUNDING_HOOKS,
  hookEntries,
  installClaudeLocal,
  isSetEntry,
  launcherProblem,
  SettingsFileError,
} from './claude-local.ts';

/** Where the grounding hooks live, relative to a checkout. */
export const HOOK_SETTINGS_PATH = CLAUDE_LOCAL_SETTINGS_PATH;
/** The settings file a team commits, relative to the project. Construct never writes it. */
export const SHARED_HOOK_SETTINGS_PATH = join('.claude', 'settings.json');

const REPAIR = '`construct init --client=claude-code` repairs them';

export interface HookWiringState {
  readonly path: string;
  readonly status: 'installed' | 'partial' | 'absent' | 'broken' | 'stale';
  readonly detail: string;
}

/** The checkout whose machine-local settings hold the hooks, and the state directory holding their launcher. */
export interface HookPlace {
  readonly checkout: string;
  readonly stateDir: string;
}

function readSettings(path: string): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  if (!existsSync(path)) return { ok: true, value: {} };
  try {
    const v = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return { ok: false, reason: 'is not a JSON object' };
    return { ok: true, value: v as Record<string, unknown> };
  } catch (error) {
    return { ok: false, reason: `is not valid JSON (${(error as Error).message})` };
  }
}

function hooksIn(settings: Record<string, unknown>): Record<string, unknown> {
  const hooks = settings.hooks;
  return hooks && typeof hooks === 'object' && !Array.isArray(hooks) ? (hooks as Record<string, unknown>) : {};
}

/** A hook that starts the checkout's own launcher through the project directory Claude Code passes, so it works on any machine. */
const PORTABLE = /\$\{?CLAUDE_PROJECT_DIR\b/;

/** A grounding hook every command of which starts the checkout's own launcher through $CLAUDE_PROJECT_DIR. */
function isPortableGroundingEntry(entry: unknown): boolean {
  const hooks = (entry as { hooks?: { command?: unknown }[] } | null)?.hooks;
  return (
    isSetEntry(entry, 'grounding') && Array.isArray(hooks) && hooks.every((h) => typeof h?.command === 'string' && PORTABLE.test(h.command))
  );
}

/** The grounding events a portable hook in the shared file covers. */
function sharedPortableEvents(settings: Record<string, unknown>): readonly string[] {
  const hooks = hooksIn(settings);
  return GROUNDING_HOOKS.map((h) => h.hostEvent).filter((event) => {
    const list = hooks[event];
    return Array.isArray(list) && list.some(isPortableGroundingEntry);
  });
}

/**
 * Whether the grounding hooks are in this checkout's machine-local settings
 * as init would write them now, or committed portably in the shared file.
 * Stale when an entry differs from what init writes now, or when the launcher
 * they run through is missing or names a Node or Construct that no longer
 * exists; re-running init repairs both.
 */
export function inspectHooks(projectRoot: string, place: HookPlace): HookWiringState {
  const path = join(place.checkout, HOOK_SETTINGS_PATH);
  const local = readSettings(path);
  if (!local.ok) return { path, status: 'broken', detail: `${HOOK_SETTINGS_PATH} ${local.reason}` };
  const shared = readSettings(join(projectRoot, SHARED_HOOK_SETTINGS_PATH));

  const hooks = hooksIn(local.value);
  const ours = Object.values(hooks).flatMap((list) => (Array.isArray(list) ? list.filter((e) => isSetEntry(e, 'grounding')) : []));
  const expected = hookEntries('grounding', place.stateDir);
  const exact = expected.filter(({ hostEvent, entry }) => {
    const list = hooks[hostEvent];
    return Array.isArray(list) && list.filter((e) => isSetEntry(e, 'grounding')).some((e) => isDeepStrictEqual(e, entry));
  });
  const reasons: string[] = [];
  if (ours.length > exact.length) reasons.push(`${HOOK_SETTINGS_PATH} has construct hooks that differ from what init writes now`);
  if (ours.length > 0) {
    const launcher = launcherProblem(place.stateDir);
    if (launcher) reasons.push(launcher);
  }
  if (reasons.length > 0) return { path, status: 'stale', detail: `${reasons.join('; ')}; ${REPAIR}` };
  if (exact.length === expected.length) {
    return {
      path,
      status: 'installed',
      detail: `${HOOK_SETTINGS_PATH} runs construct hook on ${GROUNDING_HOOKS.map((h) => h.hostEvent).join(', ')}, through Construct's launcher, on this machine only`,
    };
  }
  const committed = shared.ok ? sharedPortableEvents(shared.value) : [];
  if (committed.length === GROUNDING_HOOKS.length)
    return {
      path,
      status: 'installed',
      detail: `${SHARED_HOOK_SETTINGS_PATH}, the committed file, runs construct hook on ${committed.join(', ')} through each checkout's own launcher`,
    };
  if (exact.length === 0) return { path, status: 'absent', detail: `no construct hooks in ${HOOK_SETTINGS_PATH}` };
  return {
    path,
    status: 'partial',
    detail: `${HOOK_SETTINGS_PATH} has construct hooks for ${exact.map((h) => h.hostEvent).join(', ')} only`,
  };
}

/** Put the grounding hooks in the checkout's machine-local settings. */
export function installHooks(
  projectRoot: string,
  opts: HookPlace & { readonly env: NodeJS.ProcessEnv; readonly at: string },
): HookWiringState {
  try {
    installClaudeLocal(opts.checkout, opts.stateDir, opts.env, opts.at, 'grounding');
  } catch (error) {
    if (error instanceof SettingsFileError)
      return { path: join(opts.checkout, HOOK_SETTINGS_PATH), status: 'broken', detail: `${error.message}; left untouched` };
    throw error;
  }
  return inspectHooks(projectRoot, opts);
}
