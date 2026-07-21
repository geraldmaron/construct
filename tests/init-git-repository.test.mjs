/**
 * tests/init-git-repository.test.mjs — git repository bootstrap during init.
 *
 * Covers ensureGitRepository(): non-interactive runs auto-create `.git/`,
 * interactive declines fail with an actionable message, and existing repos
 * are left untouched.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { rmTmpDir } from './helpers/cleanup.mjs';
import { ensureGitRepository, isGitRepository } from '../lib/init-unified.mjs';

test('isGitRepository returns false before git init', () => {
  const dir = mkdtempSync(join(tmpdir(), 'init-git-unit-'));
  try {
    assert.equal(isGitRepository(dir), false);
  } finally {
    rmTmpDir(dir);
  }
});

test('ensureGitRepository auto-runs git init when skipInteractive is true', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'init-git-unit-'));
  try {
    await ensureGitRepository(dir, { skipInteractive: true, quiet: true });
    assert.equal(isGitRepository(dir), true);
    assert.ok(existsSync(join(dir, '.git')));
  } finally {
    rmTmpDir(dir);
  }
});

test('ensureGitRepository leaves an existing repository unchanged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'init-git-unit-'));
  const seeded = spawnSync('git', ['init', '--quiet'], { cwd: dir });
  assert.equal(seeded.status, 0, seeded.stderr);
  const before = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' });
  try {
    await ensureGitRepository(dir, { skipInteractive: true, quiet: true });
    const after = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' });
    assert.equal(after.stdout.trim(), before.stdout.trim());
  } finally {
    rmTmpDir(dir);
  }
});

test('ensureGitRepository fails with actionable guidance when the user declines', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'init-git-unit-'));
  const previousIsTTY = process.stdin.isTTY;
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  try {
    await assert.rejects(
      () => ensureGitRepository(dir, {
        skipInteractive: false,
        quiet: true,
        prompt: async () => false,
      }),
      (error) => {
        assert.match(error.message, /Construct requires a git repository/);
        assert.match(error.message, /Run `git init`/);
        assert.match(error.message, /docs\/guides\/start\/install\.mdx/);
        return true;
      },
    );
    assert.equal(isGitRepository(dir), false);
  } finally {
    Object.defineProperty(process.stdin, 'isTTY', { value: previousIsTTY, configurable: true });
    rmTmpDir(dir);
  }
});
