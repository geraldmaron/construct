/**
 * lib/git-hooks-path.mjs — wire a git repo's `core.hooksPath` to `.beads/hooks`
 * so Construct's pre-commit secret-scan, policy gates, and the beads dispatcher
 * activate.
 *
 * Project-scoped: it mutates the git config of the directory passed in, so it
 * is owned by `construct init` (project scaffolding), never `construct install`
 * (machine setup must not touch the cwd repo — ADR-0027 §3). The git default
 * (`.git/hooks`, set or unset) is treated as "no active choice" and overwritten;
 * a non-default custom hooksPath is left alone with a warning.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function ensureGitHooksPath({ cwd = process.cwd() } = {}) {
  const hooksDir = path.join(cwd, '.beads', 'hooks');
  if (!fs.existsSync(path.join(hooksDir, 'pre-commit'))) {
    return { status: 'skipped', reason: 'no .beads/hooks/pre-commit in this directory' };
  }
  const inGit = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, stdio: 'pipe', encoding: 'utf8' });
  if (inGit.status !== 0) {
    return { status: 'skipped', reason: 'not a git working tree' };
  }
  const current = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd, stdio: 'pipe', encoding: 'utf8' });
  const currentValue = current.status === 0 ? (current.stdout || '').trim() : '';
  const desired = '.beads/hooks';
  if (currentValue === desired) {
    return { status: 'ok', message: 'core.hooksPath already wired to .beads/hooks' };
  }

  // Treat the git default (`.git/hooks` or an absolute path to it) as
  // equivalent to unset. A user who has accepted the default has not made an
  // active choice that justifies "leave alone" semantics; without this branch
  // an install that happens to land while `.git/hooks` is already in play
  // leaves policy gates inactive permanently.

  const isGitDefault =
    !currentValue ||
    currentValue === '.git/hooks' ||
    currentValue === path.join(cwd, '.git', 'hooks') ||
    currentValue.replace(/\/+$/, '').endsWith(`${path.sep}.git${path.sep}hooks`);
  if (!isGitDefault) {
    return {
      status: 'warning',
      message: `core.hooksPath is set to '${currentValue}'. Leaving alone. Set to '.beads/hooks' to activate Construct policy gates.`,
    };
  }
  const result = spawnSync('git', ['config', 'core.hooksPath', desired], { cwd, stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) {
    return {
      status: 'error',
      message: `failed to set core.hooksPath: ${(result.stderr || '').trim() || 'unknown error'}`,
    };
  }
  return {
    status: 'set',
    message: 'core.hooksPath set to .beads/hooks (activates pre-commit secret-scan + Construct policy gates + beads dispatcher)',
  };
}
