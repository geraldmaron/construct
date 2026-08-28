/**
 * hosts/prompthook.ts — the prompt-submit hook `construct wire` plants so
 * ordinary talk records a run without the host choosing a tool.
 *
 * Cursor runs `.cursor/hooks.json` `beforeSubmitPrompt`. Claude Code runs
 * `.claude/settings.json` `UserPromptSubmit`. Both feed the user text to
 * `construct hear` on stdin. The host fires the hook; the model does not
 * have to call `record_outcome`.
 *
 * Only this command is added. Other hooks in the same file stay.
 */

import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export interface HearLaunch {
  readonly command?: string;
  readonly args?: readonly string[];
}

const DEFAULT_HEAR_ARGS: readonly string[] = [
  fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url)),
  'hear',
];

/** Shell line a host hook config stores. */
export function hearCommandLine(launch: HearLaunch = {}): string {
  const command = launch.command ?? process.execPath;
  const args = launch.args ?? DEFAULT_HEAR_ARGS;
  return [command, ...args]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(' ');
}

/** Whether this hook command is the hear recorder this module plants. */
export function isHearCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  return (
    /(?:^|[\s"'/])construct(?:\.mjs)?\s+hear(?:\s|"|'|$)/.test(command) ||
    /hear-talk\.mjs/.test(command)
  );
}

export function cursorHooksPath(cwd: string): string {
  return join(cwd, '.cursor', 'hooks.json');
}

export function claudeSettingsPath(cwd: string): string {
  return join(cwd, '.claude', 'settings.json');
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hookCommands(entry: unknown): string[] {
  if (entry === null || typeof entry !== 'object') return [];
  const direct = (entry as { command?: unknown }).command;
  const inner = (entry as { hooks?: unknown }).hooks;
  const fromInner = Array.isArray(inner)
    ? inner.flatMap((item) => hookCommands(item))
    : [];
  return typeof direct === 'string' ? [direct, ...fromInner] : fromInner;
}

export function cursorHearHookPresent(config: Record<string, unknown>): boolean {
  const hooks = asObject(config.hooks);
  const entries = hooks.beforeSubmitPrompt;
  if (!Array.isArray(entries)) return false;
  return entries.some((entry) => hookCommands(entry).some(isHearCommand));
}

export function claudeHearHookPresent(config: Record<string, unknown>): boolean {
  const hooks = asObject(config.hooks);
  const entries = hooks.UserPromptSubmit;
  if (!Array.isArray(entries)) return false;
  return entries.some((entry) => hookCommands(entry).some(isHearCommand));
}

/** Merge the hear recorder into Cursor project hooks. Other hooks stay. */
export function mergeCursorHearHook(
  existing: Record<string, unknown>,
  command = hearCommandLine(),
): Record<string, unknown> {
  if (cursorHearHookPresent(existing)) return existing;
  const hooks = asObject(existing.hooks);
  const current = Array.isArray(hooks.beforeSubmitPrompt) ? hooks.beforeSubmitPrompt : [];
  return {
    ...existing,
    version: existing.version ?? 1,
    hooks: {
      ...hooks,
      beforeSubmitPrompt: [...current, { command }],
    },
  };
}

/** Merge the hear recorder into Claude project settings. Other hooks stay. */
export function mergeClaudeHearHook(
  existing: Record<string, unknown>,
  command = hearCommandLine(),
): Record<string, unknown> {
  if (claudeHearHookPresent(existing)) return existing;
  const hooks = asObject(existing.hooks);
  const current = Array.isArray(hooks.UserPromptSubmit) ? hooks.UserPromptSubmit : [];
  return {
    ...existing,
    hooks: {
      ...hooks,
      UserPromptSubmit: [
        ...current,
        { hooks: [{ type: 'command', command }] },
      ],
    },
  };
}
