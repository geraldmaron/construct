/**
 * tests/functional/sync-per-host-isolation.functional.test.mjs
 *
 * One host throwing mid-sync (an unwritable directory, a malformed existing
 * config) must not abort the other hosts, and any file that WAS staged by a
 * host that ran cleanly must still be committed — the previous shape was a
 * single try/finally around every host, so the first throw aborted the rest
 * of the sequence and skipped commitStaging() entirely.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYNC_SCRIPT = join(REPO_ROOT, 'scripts', 'sync-specialists.mjs');
const ALL_HOSTS = 'claude,codex,copilot,opencode,vscode,cursor';

function makeIsolatedEnv() {
  const sandbox = mkdtempSync(join(tmpdir(), 'sync-isolation-'));
  const HOME = join(sandbox, 'HOME');
  const project = join(sandbox, 'project');
  mkdirSync(HOME, { recursive: true });
  mkdirSync(project, { recursive: true });
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: project });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: project });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: project });
  return {
    sandbox, HOME, project,
    cleanup() {
      try { chmodSync(join(project, '.cursor'), 0o700); } catch { /* may not exist */ }
      rmTmpDir(sandbox);
    },
  };
}

function runSync(env, args) {
  return spawnSync(process.execPath, [SYNC_SCRIPT, ...args], {
    cwd: env.project,
    encoding: 'utf8',
    timeout: 90_000,
    env: {
      ...process.env,
      HOME: env.HOME,
      CONSTRUCT_SKIP_POSTINSTALL: '1',
      CONSTRUCT_SYNC_HOSTS: ALL_HOSTS,
    },
  });
}

test('a read-only Cursor directory fails only Cursor — Claude, Codex, and Copilot still commit, exit is nonzero', () => {
  const env = makeIsolatedEnv();
  try {
    // Pre-create .cursor read-only so syncCursor's direct fs.writeFileSync
    // throws EACCES while every other host's writes go through normally.
    mkdirSync(join(env.project, '.cursor'), { recursive: true });
    chmodSync(join(env.project, '.cursor'), 0o500);

    const result = runSync(env, ['--project']);
    assert.notEqual(result.status, 0, 'a host failure must exit nonzero');
    assert.match(result.stderr, /Cursor/, 'the failure report must name Cursor');

    assert.ok(existsSync(join(env.project, '.claude', 'agents', 'construct.md')), 'Claude must still commit despite Cursor failing');
    assert.ok(existsSync(join(env.project, '.codex', 'agents', 'construct.toml')), 'Codex must still commit despite Cursor failing');
    assert.ok(existsSync(join(env.project, '.github', 'prompts', 'construct.prompt.md')), 'Copilot must still commit despite Cursor failing');
    assert.ok(existsSync(join(env.project, '.opencode', 'opencode.json')), 'OpenCode must still commit despite Cursor failing');
  } finally {
    env.cleanup();
  }
});

test('a clean sync across all hosts exits 0 with no failure report', () => {
  const env = makeIsolatedEnv();
  try {
    const result = runSync(env, ['--project']);
    assert.equal(result.status, 0, `expected a clean run: ${result.stderr}`);
    assert.doesNotMatch(result.stderr, /host\(s\) failed/);
  } finally {
    env.cleanup();
  }
});
