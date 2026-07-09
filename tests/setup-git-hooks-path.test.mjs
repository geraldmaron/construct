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
import { rmTmpDir } from './helpers/cleanup.mjs';

// `GIT_CEILING_DIRECTORIES` stops git from walking past the tmp dir when it
// looks for a parent repo. Without this, if `git init` in the tmp dir failed
// for any reason, subsequent `git config` calls would write to the nearest
// ancestor repo (the host repo running the test). Defense in depth: even if
// init silently failed, the wrong config never lands.
function gitEnv(ceilingDir) {
  return { ...process.env, GIT_CEILING_DIRECTORIES: ceilingDir };
}

function mkProject(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-setup-hookspath-'));
  t.after(() => rmTmpDir(dir));
  const ceiling = os.tmpdir();
  const init = spawnSync('git', ['init', '-q'], { cwd: dir, env: gitEnv(ceiling) });
  if (init.status !== 0) {
    throw new Error(`git init failed in ${dir}: ${(init.stderr || init.stdout || '').toString()}`);
  }
  if (!fs.existsSync(path.join(dir, '.git'))) {
    throw new Error(`git init reported success but ${dir}/.git is missing`);
  }
  fs.mkdirSync(path.join(dir, '.beads', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.beads', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return { dir, env: gitEnv(ceiling) };
}

function readHooksPath(cwd, env) {
  const r = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd, env, stdio: 'pipe', encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : '';
}

describe('ensureGitHooksPath', () => {
  it('wires .beads/hooks when core.hooksPath is unset', (t) => {
    const { dir, env } = mkProject(t);
    const result = ensureGitHooksPath({ cwd: dir });
    assert.equal(result.status, 'set');
    assert.equal(readHooksPath(dir, env), '.beads/hooks');
  });

  it('is a no-op when already wired to .beads/hooks', (t) => {
    const { dir, env } = mkProject(t);
    spawnSync('git', ['config', 'core.hooksPath', '.beads/hooks'], { cwd: dir, env });
    const result = ensureGitHooksPath({ cwd: dir });
    assert.equal(result.status, 'ok');
    assert.equal(readHooksPath(dir, env), '.beads/hooks');
  });

  it('rewires when core.hooksPath is the relative git default (.git/hooks)', (t) => {
    const { dir, env } = mkProject(t);
    spawnSync('git', ['config', 'core.hooksPath', '.git/hooks'], { cwd: dir, env });
    const result = ensureGitHooksPath({ cwd: dir });
    assert.equal(result.status, 'set', `expected status=set, got ${JSON.stringify(result)}`);
    assert.equal(readHooksPath(dir, env), '.beads/hooks');
  });

  it('rewires when core.hooksPath is an absolute path to .git/hooks', (t) => {
    const { dir, env } = mkProject(t);
    spawnSync('git', ['config', 'core.hooksPath', path.join(dir, '.git', 'hooks')], { cwd: dir, env });
    const result = ensureGitHooksPath({ cwd: dir });
    assert.equal(result.status, 'set', `expected status=set, got ${JSON.stringify(result)}`);
    assert.equal(readHooksPath(dir, env), '.beads/hooks');
  });

  it('leaves a real custom hooksPath alone (warning, no overwrite)', (t) => {
    const { dir, env } = mkProject(t);
    const custom = path.join(dir, 'my-hooks');
    fs.mkdirSync(custom, { recursive: true });
    spawnSync('git', ['config', 'core.hooksPath', custom], { cwd: dir, env });
    const result = ensureGitHooksPath({ cwd: dir });
    assert.equal(result.status, 'warning');
    assert.equal(readHooksPath(dir, env), custom, 'custom value must not be overwritten');
  });

  it('skips when no .beads/hooks/pre-commit exists in the project', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-setup-hookspath-skip-'));
    t.after(() => rmTmpDir(dir));
    const env = { ...process.env, GIT_CEILING_DIRECTORIES: os.tmpdir() };
    const init = spawnSync('git', ['init', '-q'], { cwd: dir, env });
    if (init.status !== 0) throw new Error(`git init failed: ${init.stderr || init.stdout || ''}`);
    const result = ensureGitHooksPath({ cwd: dir });
    assert.equal(result.status, 'skipped');
  });
});
