/**
 * hosts/wiring/hooks.ts — put Construct's lifecycle hooks into a host's
 * project settings, and say whether they are there.
 *
 * Claude Code reads hooks from .claude/settings.json. The merge is
 * additive: other hooks and settings are left as they are, and an entry
 * Construct already wrote is recognized and not duplicated. A settings file
 * that is not valid JSON is never overwritten.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LAUNCHER } from './clients.ts';

export const HOOK_SETTINGS_PATH = join('.claude', 'settings.json');

/** Host event → Construct hook event, with the tool matcher for tool events. */
const HOOKS: readonly { readonly hostEvent: string; readonly event: string; readonly matcher?: string }[] = [
  // Every tool: a Jira read can come from any connector's tool name. The handler ignores Construct's own tools.
  { hostEvent: 'PostToolUse', event: 'post-tool', matcher: '*' },
  { hostEvent: 'Stop', event: 'stop' },
  { hostEvent: 'SessionStart', event: 'session-start' },
];

export interface HookWiringState {
  readonly path: string;
  readonly status: 'installed' | 'partial' | 'absent' | 'broken';
  readonly detail: string;
}

function command(event: string, root: string): string {
  const quote = (s: string) => (/^[\w./:@=-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  return [process.execPath, LAUNCHER, 'hook', event, '--client=claude-code', `--project=${root}`].map(quote).join(' ');
}

function isOurs(entry: unknown, event: string): boolean {
  const hooks = (entry as { hooks?: { command?: unknown }[] } | null)?.hooks;
  return Array.isArray(hooks) && hooks.some((h) => typeof h.command === 'string' && h.command.includes('construct') && h.command.includes(` hook ${event}`));
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

export function inspectHooks(projectRoot: string): HookWiringState {
  const path = join(projectRoot, HOOK_SETTINGS_PATH);
  const read = readSettings(path);
  if (!read.ok) return { path, status: 'broken', detail: `${HOOK_SETTINGS_PATH} ${read.reason}` };
  const hooks = (read.value.hooks ?? {}) as Record<string, unknown[]>;
  const present = HOOKS.filter((h) => Array.isArray(hooks[h.hostEvent]) && hooks[h.hostEvent]!.some((e) => isOurs(e, h.event)));
  if (present.length === HOOKS.length) return { path, status: 'installed', detail: `${HOOK_SETTINGS_PATH} runs construct hook on ${HOOKS.map((h) => h.hostEvent).join(', ')}` };
  if (present.length === 0) return { path, status: 'absent', detail: `no construct hooks in ${HOOK_SETTINGS_PATH}` };
  return { path, status: 'partial', detail: `${HOOK_SETTINGS_PATH} has construct hooks for ${present.map((h) => h.hostEvent).join(', ')} only` };
}

export function installHooks(projectRoot: string): HookWiringState {
  const path = join(projectRoot, HOOK_SETTINGS_PATH);
  const read = readSettings(path);
  if (!read.ok) return { path, status: 'broken', detail: `${HOOK_SETTINGS_PATH} ${read.reason}; left untouched` };
  const settings = read.value;
  const hooks = { ...((settings.hooks ?? {}) as Record<string, unknown[]>) };
  for (const h of HOOKS) {
    const list = Array.isArray(hooks[h.hostEvent]) ? [...hooks[h.hostEvent]!] : [];
    if (list.some((e) => isOurs(e, h.event))) continue;
    list.push({ ...(h.matcher ? { matcher: h.matcher } : {}), hooks: [{ type: 'command', command: command(h.event, projectRoot), timeout: 20 }] });
    hooks[h.hostEvent] = list;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...settings, hooks }, null, 2)}\n`, 'utf8');
  return inspectHooks(projectRoot);
}
