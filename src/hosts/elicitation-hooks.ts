/**
 * hosts/elicitation-hooks.ts — whether anything on this machine could answer
 * a question the host shows the person, in the person's place.
 *
 * Construct asks the person directly through the host's elicitation for the
 * answers only they may give. Claude Code runs `Elicitation` and
 * `ElicitationResult` hooks that can supply or rewrite that answer without the
 * person, and other hosts that import Claude Code's hooks inherit them. Where
 * any such hook is configured, a prompt answer cannot count as the person's,
 * so Construct does not ask that way and the question waits in the inbox.
 *
 * The check reads configuration only and never reports a value. It reads a
 * file the way the host does, as JSON, so an escaped key such as
 * `\u0045licitation` is seen for what it is. Not knowing is never taken as
 * the person: a file that exists but cannot be read or parsed, or a plugin
 * tree too large to walk, counts as able to answer. The server repeats the
 * check before every question and again when the answer arrives, so a hook
 * written while it runs is seen.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ANSWERING_EVENTS = new Set(['Elicitation', 'ElicitationResult']);
const PLUGIN_SCAN_LIMIT = 4000;

/** Marks a plugin tree too large to check: it counts as able to answer. */
export const UNCHECKED_PLUGIN_TREE = '(plugin directory too large to check)';

/** The settings files at a checkout where project hooks live. */
export function projectHookFiles(checkout: string): string[] {
  return [join(checkout, '.claude', 'settings.json'), join(checkout, '.claude', 'settings.local.json')];
}

/** Hook files installed plugins carry, found under the Claude configuration directory. */
export function pluginHookFiles(claudeDir: string): string[] {
  const root = join(claudeDir, 'plugins');
  const out: string[] = [];
  let seen = 0;
  const walk = (dir: string, depth: number): void => {
    if (seen > PLUGIN_SCAN_LIMIT) return;
    if (depth > 7) {
      if (!out.includes(UNCHECKED_PLUGIN_TREE)) out.push(UNCHECKED_PLUGIN_TREE);
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      seen += 1;
      if (seen > PLUGIN_SCAN_LIMIT) {
        if (!out.includes(UNCHECKED_PLUGIN_TREE)) out.push(UNCHECKED_PLUGIN_TREE);
        return;
      }
      const path = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(path).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (name !== 'node_modules' && name !== '.git') walk(path, depth + 1);
      } else if (name === 'hooks.json') out.push(path);
    }
  };
  walk(root, 0);
  return out;
}

/** Whether a parsed settings value names an answering hook event anywhere in it. */
function namesAnsweringEvent(value: unknown, depth = 0): boolean {
  if (depth > 32 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => namesAnsweringEvent(v, depth + 1));
  return Object.entries(value).some(([key, inner]) => ANSWERING_EVENTS.has(key) || namesAnsweringEvent(inner, depth + 1));
}

/** The files among `files` that configure, or might configure, a hook able to answer an elicitation. */
export function elicitationAnswerers(files: readonly string[]): string[] {
  return files.filter((file) => {
    if (file === UNCHECKED_PLUGIN_TREE) return true;
    if (!existsSync(file)) return false;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      return true;
    }
    try {
      return namesAnsweringEvent(JSON.parse(text));
    } catch {
      return true;
    }
  });
}
