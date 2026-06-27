/**
 * tests/visual/lib/terminal-replay.mjs — open a real Terminal window on macOS.
 *
 * Optional companion to the browser dashboard: launches Terminal.app with a paced
 * construct replay so you see the actual TUI (colors, banner, slash output).
 */

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function launchTerminalReplay() {
  if (process.platform !== 'darwin') return false;
  const script = path.join(REPO_ROOT, 'scripts', 'visual-terminal-replay.mjs');
  const escaped = `node ${script}`.replace(/"/g, '\\"');
  spawnSync('osascript', [
    '-e', 'tell application "Terminal" to activate',
    '-e', `tell application "Terminal" to do script "cd ${REPO_ROOT.replace(/"/g, '\\"')} && ${escaped}"`,
  ], { stdio: 'ignore' });
  return true;
}
