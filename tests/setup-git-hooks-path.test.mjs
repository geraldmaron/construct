/**
 * tests/setup-git-hooks-path.test.mjs — ensureGitHooksPath behavior.
 *
 * Regression coverage for the bug where ensureGitHooksPath treated the git
 * default core.hooksPath value (`.git/hooks`, set explicitly or via the
 * absolute path) as a "user-set" value and refused to wire `.beads/hooks`.
 * The fix recognizes the default location as equivalent to unset and proceeds.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureGitHooksPath } from '../lib/setup.mjs';

function mkProject(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-setup-hookspath-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.beads', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.beads', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return dir;
}

function readHooksPath(cwd) {
  const r = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd, stdio: 'pipe', encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : '';
}

describe('ensureGitHooksPath', () => {
  it('wires .beads/hooks when core.hooksPath is unset', (t) => {
    const cwd = mkProject(t);
    const result = ensureGitHooksPath({ cwd });
    assert.equal(result.status, 'set');
    assert.equal(readHooksPath(cwd), '.beads/hooks');
  });

  it('is a no-op when already wired to .beads/hooks', (t) => {
    const cwd = mkProject(t);
    spawnSync('git', ['config', 'core.hooksPath', '.beads/hooks'], { cwd });
    const result = ensureGitHooksPath({ cwd });
    assert.equal(result.status, 'ok');
    assert.equal(readHooksPath(cwd), '.beads/hooks');
  });

  it('rewires when core.hooksPath is the relative git default (.git/hooks)', (t) => {
    const cwd = mkProject(t);
    spawnSync('git', ['config', 'core.hooksPath', '.git/hooks'], { cwd });
    const result = ensureGitHooksPath({ cwd });
    assert.equal(result.status, 'set', `expected status=set, got ${JSON.stringify(result)}`);
    assert.equal(readHooksPath(cwd), '.beads/hooks');
  });

  it('rewires when core.hooksPath is an absolute path to .git/hooks', (t) => {
    const cwd = mkProject(t);
    spawnSync('git', ['config', 'core.hooksPath', path.join(cwd, '.git', 'hooks')], { cwd });
    const result = ensureGitHooksPath({ cwd });
    assert.equal(result.status, 'set', `expected status=set, got ${JSON.stringify(result)}`);
    assert.equal(readHooksPath(cwd), '.beads/hooks');
  });

  it('leaves a real custom hooksPath alone (warning, no overwrite)', (t) => {
    const cwd = mkProject(t);
    const custom = path.join(cwd, 'my-hooks');
    fs.mkdirSync(custom, { recursive: true });
    spawnSync('git', ['config', 'core.hooksPath', custom], { cwd });
    const result = ensureGitHooksPath({ cwd });
    assert.equal(result.status, 'warning');
    assert.equal(readHooksPath(cwd), custom, 'custom value must not be overwritten');
  });

  it('skips when no .beads/hooks/pre-commit exists in the project', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-setup-hookspath-skip-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const result = ensureGitHooksPath({ cwd: dir });
    assert.equal(result.status, 'skipped');
  });
});
