/**
 * hosts/wiring/hooks.ts — Construct's grounding hooks for Claude Code: put
 * them in the checkout's machine-local settings, take Construct's own old
 * copies out of the shared settings file, and say whether they are there and
 * current.
 *
 * The hooks live in .claude/settings.local.json, which stays on this machine
 * and out of git, and find Node and Construct through the launcher in the
 * project's state directory, so no file a team commits names a path on this
 * machine. claude-local.ts is that file's one writer. In .claude/settings.json,
 * the shared file, Construct only removes hooks it wrote there itself: the
 * person's other hooks and settings stay, and a file that is not valid JSON
 * is never rewritten.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  CLAUDE_LOCAL_SETTINGS_PATH,
  GROUNDING_HOOKS,
  hookEntries,
  installClaudeLocal,
  isSetCommand,
  isSetEntry,
  launcherProblem,
  SettingsFileError,
} from './claude-local.ts';

/** Where the grounding hooks live, relative to a checkout. */
export const HOOK_SETTINGS_PATH = CLAUDE_LOCAL_SETTINGS_PATH;
/** The settings file a team commits, relative to the project. Construct writes no hook there. */
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

/** A grounding hook Construct wrote into the shared file: a construct command running ` hook <event> --client=claude-code`. */
function isSharedGroundingEntry(entry: unknown): boolean {
  const hooks = (entry as { hooks?: { command?: unknown }[] } | null)?.hooks;
  return Array.isArray(hooks) && hooks.some((h) => typeof h?.command === 'string' && h.command.includes('construct') && isSetCommand(h.command, 'grounding'));
}

/** The shared settings without Construct's grounding hooks, and how many it held. The hooks key goes when nothing is left in it. */
function withoutSharedGrounding(settings: Record<string, unknown>): { readonly settings: Record<string, unknown>; readonly removed: number } {
  let removed = 0;
  const kept: Record<string, unknown> = {};
  for (const [event, list] of Object.entries(hooksIn(settings))) {
    if (!Array.isArray(list)) {
      kept[event] = list;
      continue;
    }
    const rest = list.filter((e) => !isSharedGroundingEntry(e));
    removed += list.length - rest.length;
    if (rest.length > 0) kept[event] = rest;
  }
  if (removed === 0) return { settings, removed };
  const { hooks: _dropped, ...others } = settings;
  return { settings: Object.keys(kept).length > 0 ? { ...others, hooks: kept } : others, removed };
}

/**
 * Whether the grounding hooks are in this checkout's machine-local settings
 * as init would write them now. Stale when the shared file still holds
 * Construct's old hooks, when an entry differs from what init writes now, or
 * when the launcher they run through is missing or names a Node or Construct
 * that no longer exists; re-running init repairs every one of those.
 */
export function inspectHooks(projectRoot: string, place: HookPlace): HookWiringState {
  const path = join(place.checkout, HOOK_SETTINGS_PATH);
  const local = readSettings(path);
  if (!local.ok) return { path, status: 'broken', detail: `${HOOK_SETTINGS_PATH} ${local.reason}` };
  const shared = readSettings(join(projectRoot, SHARED_HOOK_SETTINGS_PATH));
  if (!shared.ok) return { path, status: 'broken', detail: `${SHARED_HOOK_SETTINGS_PATH} ${shared.reason}, so Construct cannot tell whether its old hooks are still there` };

  const hooks = hooksIn(local.value);
  const ours = Object.values(hooks).flatMap((list) => (Array.isArray(list) ? list.filter((e) => isSetEntry(e, 'grounding')) : []));
  const expected = hookEntries('grounding', place.stateDir);
  const exact = expected.filter(({ hostEvent, entry }) => {
    const list = hooks[hostEvent];
    return Array.isArray(list) && list.filter((e) => isSetEntry(e, 'grounding')).some((e) => isDeepStrictEqual(e, entry));
  });
  const reasons: string[] = [];
  const old = withoutSharedGrounding(shared.value).removed;
  if (old > 0) reasons.push(`${SHARED_HOOK_SETTINGS_PATH}, the shared file, still holds ${String(old)} construct hook(s) that name one machine's Node and install`);
  if (ours.length > exact.length) reasons.push(`${HOOK_SETTINGS_PATH} has construct hooks that differ from what init writes now`);
  if (ours.length > 0) {
    const launcher = launcherProblem(place.stateDir);
    if (launcher) reasons.push(launcher);
  }
  if (reasons.length > 0) return { path, status: 'stale', detail: `${reasons.join('; ')}; ${REPAIR}` };
  if (exact.length === expected.length) {
    return { path, status: 'installed', detail: `${HOOK_SETTINGS_PATH} runs construct hook on ${GROUNDING_HOOKS.map((h) => h.hostEvent).join(', ')}, through Construct's launcher, on this machine only` };
  }
  if (exact.length === 0) return { path, status: 'absent', detail: `no construct hooks in ${HOOK_SETTINGS_PATH}` };
  return { path, status: 'partial', detail: `${HOOK_SETTINGS_PATH} has construct hooks for ${exact.map((h) => h.hostEvent).join(', ')} only` };
}

/**
 * Put the grounding hooks in the checkout's machine-local settings, then take
 * Construct's old copies out of the shared settings file. The shared file is
 * changed only once the hooks are in place, so a machine-local file Construct
 * will not edit leaves both files as they were.
 */
export function installHooks(projectRoot: string, opts: HookPlace & { readonly env: NodeJS.ProcessEnv; readonly at: string }): HookWiringState {
  try {
    installClaudeLocal(opts.checkout, opts.stateDir, opts.env, opts.at, 'grounding');
  } catch (error) {
    if (error instanceof SettingsFileError) return { path: join(opts.checkout, HOOK_SETTINGS_PATH), status: 'broken', detail: `${error.message}; left untouched` };
    throw error;
  }
  const sharedPath = join(projectRoot, SHARED_HOOK_SETTINGS_PATH);
  const shared = readSettings(sharedPath);
  let moved = 0;
  if (shared.ok && existsSync(sharedPath)) {
    const cleaned = withoutSharedGrounding(shared.value);
    if (cleaned.removed > 0) {
      writeFileSync(sharedPath, `${JSON.stringify(cleaned.settings, null, 2)}\n`, 'utf8');
      moved = cleaned.removed;
    }
  }
  const state = inspectHooks(projectRoot, opts);
  return moved > 0 ? { ...state, detail: `${state.detail}; moved ${String(moved)} old construct hook(s) out of ${SHARED_HOOK_SETTINGS_PATH}` } : state;
}
