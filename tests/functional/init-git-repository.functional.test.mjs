/**
 * tests/functional/init-git-repository.functional.test.mjs
 *
 * End-to-end coverage for init's git bootstrap UX: a non-git project dir
 * with `--yes` auto-runs `git init` and completes; `--interactive` with a
 * declined prompt fails with an actionable error instead of a bare gate.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'init-git-func-'));
  const HOME = join(root, 'HOME');
  const project = join(root, 'project');
  mkdirSync(HOME, { recursive: true });
  mkdirSync(project, { recursive: true });
  return {
    root,
    HOME,
    project,
    env: sterileSpawnEnv({
      HOME,
      USERPROFILE: HOME,
      CONSTRUCT_HOME_OVERRIDE: HOME,
      XDG_CONFIG_HOME: join(HOME, '.config'),
      XDG_DATA_HOME: join(HOME, '.local', 'share'),
      XDG_CACHE_HOME: join(HOME, '.cache'),
      XDG_RUNTIME_DIR: join(HOME, 'run'),
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
      NODE_ENV: 'test',
    }),
    cleanup() {
      rmTmpDir(root);
    },
  };
}

test('construct init --yes auto-runs git init in a non-git directory', () => {
  const s = sandbox();
  try {
    assert.equal(existsSync(join(s.project, '.git')), false);

    const result = spawnSync(
      process.execPath,
      [BIN, 'init', '--yes', '--no-start', '--no-beads'],
      {
        cwd: s.project,
        encoding: 'utf8',
        timeout: 120_000,
        env: s.env,
      },
    );

    assert.equal(result.status, 0, `init failed: ${result.stderr || result.stdout}`);
    assert.ok(existsSync(join(s.project, '.git')), 'expected git init to create .git/');
    assert.match(result.stdout, /No git repository found — running `git init`/);
    assert.ok(existsSync(join(s.project, '.construct')));
  } finally {
    s.cleanup();
  }
});

test('construct init --interactive without a TTY fails with actionable guidance', () => {
  const s = sandbox();
  try {
    const result = spawnSync(
      process.execPath,
      [BIN, 'init', '--interactive', '--no-start', '--no-beads'],
      {
        cwd: s.project,
        encoding: 'utf8',
        timeout: 120_000,
        env: s.env,
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Not a git repository/);
    assert.match(result.stderr, /Run `git init`/);
    assert.equal(existsSync(join(s.project, '.git')), false);
  } finally {
    s.cleanup();
  }
});

test('construct init without git repo fails clearly when git is unavailable', () => {
  const s = sandbox();
  const noGitPath = join(s.root, 'empty-bin');
  mkdirSync(noGitPath, { recursive: true });
  try {
    const result = spawnSync(
      process.execPath,
      [BIN, 'init', '--yes', '--no-start', '--no-beads'],
      {
        cwd: s.project,
        encoding: 'utf8',
        timeout: 120_000,
        env: {
          ...s.env,
          PATH: noGitPath,
        },
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Git is required but was not found on PATH/);
    assert.match(result.stderr, /git init/);
    assert.equal(existsSync(join(s.project, '.git')), false);
  } finally {
    s.cleanup();
  }
});
