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
 * The check reads configuration only and never reports a value. It matches
 * the event names in the raw text, so a file that is not valid JSON but names
 * the event still counts as configuring it.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ANSWERING_EVENT = /"Elicitation(?:Result)?"\s*:/;
const PLUGIN_SCAN_LIMIT = 4000;

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
    if (depth > 7 || seen > PLUGIN_SCAN_LIMIT) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      seen += 1;
      if (seen > PLUGIN_SCAN_LIMIT) return;
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

/** The files among `files` that configure a hook able to answer an elicitation. */
export function elicitationAnswerers(files: readonly string[]): string[] {
  return files.filter((file) => {
    if (!existsSync(file)) return false;
    try {
      return ANSWERING_EVENT.test(readFileSync(file, 'utf8'));
    } catch {
      return false;
    }
  });
}
