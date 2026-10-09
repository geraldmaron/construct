/** Native startup context is guidance, never a host permission or enforcement hook.
 * Cursor documents alwaysApply rules for both editor and CLI:
 * https://cursor.com/docs/rules and https://cursor.com/docs/cli/using
 * Other hosts retain their installed operational skill and MCP entry point.
 */
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { INTERACTIVE_ENTRY_GUIDANCE } from '../../kernel/broker/context.ts';
import type { WirableClient } from './clients.ts';

export const CURSOR_STARTUP_PATH = '.cursor/rules/construct.mdc';
export const CURSOR_STARTUP = `---
description: Construct project operating contract
alwaysApply: true
---

Call Construct bootstrap once at the beginning of this session. ${INTERACTIVE_ENTRY_GUIDANCE}

Use the installed construct skill for the tool contracts. Select methods from the live registry and honor the claim packet. A request for an assessment can finish with clearly reported unknowns; prerequisites for later execution do not prevent delivering that assessment. Select a workflow whose verification you can actually perform with the current permissions. Do not invent execution receipts or widen permissions. If a tool rejects input, repair it before relying on the result. Say explicitly when a requested managed outcome did not finish.
`;

export interface StartupState {
  readonly path: string;
  readonly status: 'absent' | 'installed' | 'diverged' | 'broken';
  readonly detail: string;
}

export function inspectStartup(client: WirableClient, root: string): StartupState | null {
  if (client !== 'cursor') return null;
  const path = join(root, CURSOR_STARTUP_PATH);
  try {
    for (const relative of ['.cursor', '.cursor/rules', CURSOR_STARTUP_PATH]) {
      const stat = lstatSync(join(root, relative));
      if (stat.isSymbolicLink()) return { path, status: 'broken', detail: `${relative} is a symbolic link; left untouched` };
      if (relative === CURSOR_STARTUP_PATH ? !stat.isFile() : !stat.isDirectory()) return { path, status: 'broken', detail: `${relative} has the wrong file type; left untouched` };
    }
    return readFileSync(path, 'utf8') === CURSOR_STARTUP
      ? { path, status: 'installed', detail: 'always-applied startup guidance installed; host compliance is not enforced' }
      : { path, status: 'diverged', detail: 'startup rule differs from this package; left untouched for review' };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { path, status: 'absent', detail: 'startup rule absent' }
      : { path, status: 'broken', detail: 'startup rule cannot be inspected; left untouched' };
  }
}

export function installStartup(client: WirableClient, root: string): StartupState | null {
  const state = inspectStartup(client, root);
  if (state === null || state.status !== 'absent') return state;
  try {
    mkdirSync(join(root, '.cursor/rules'), { recursive: true });
    writeFileSync(state.path, CURSOR_STARTUP, { flag: 'wx' });
  } catch {
    const current = inspectStartup(client, root)!;
    return current.status === 'absent' ? { ...current, status: 'broken', detail: 'startup rule could not be created; existing files left untouched' } : current;
  }
  return inspectStartup(client, root);
}
