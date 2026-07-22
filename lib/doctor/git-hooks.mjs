/**
 * lib/doctor/git-hooks.mjs — project-scoped git hooksPath check for doctor.
 *
 * Reads core.hooksPath from the project's git config (not the Construct install
 * checkout) and verifies the configured directory holds a pre-commit hook when
 * the project ships .beads/hooks/pre-commit.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * @param {string} projectDir
 * @param {{ spawnSyncImpl?: typeof spawnSync, inCI?: boolean }} [opts]
 * @returns {{ run: boolean, pass: boolean, label: string }}
 */
export function checkProjectGitHooks(projectDir, { spawnSyncImpl = spawnSync, inCI = false } = {}) {
  const beadsPreCommit = path.join(projectDir, '.beads', 'hooks', 'pre-commit');
  if (!fs.existsSync(beadsPreCommit) || inCI) {
    return { run: false, pass: true, label: '' };
  }

  const hp = spawnSyncImpl('git', ['config', '--get', 'core.hooksPath'], { cwd: projectDir, encoding: 'utf8' });
  const value = hp.status === 0 ? (hp.stdout || '').trim() : '';

  const absEquiv = path.join(projectDir, '.beads', 'hooks');
  const resolved = value && (path.isAbsolute(value) ? value : path.join(projectDir, value));
  const wired = value === '.beads/hooks'
    || value === absEquiv
    || Boolean(resolved && fs.existsSync(path.join(resolved, 'pre-commit')));

  const label = wired
    ? `Git hooks wired (core.hooksPath = ${value})`
    : value
      ? `Git hooks unwired (core.hooksPath = '${value}', expected '.beads/hooks') — pre-commit policy gates inactive. Fix: git config core.hooksPath .beads/hooks`
      : 'Git hooks unwired (core.hooksPath unset) — pre-commit policy gates inactive. Fix: git config core.hooksPath .beads/hooks';

  return { run: true, pass: wired, label };
}
