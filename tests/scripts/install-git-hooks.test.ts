/**
 * tests/scripts/install-git-hooks.test.ts — the installer points git at the
 * tracked .githooks, and the hooks there gate a real commit in a scratch
 * repository: a failing secret scan blocks it, an attribution trailer is
 * refused, and a linked worktree runs its own checkout's hooks.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

function scratch(secretScan = 'process.exit(0);\n') {
  const root = mkdtempSync(join(tmpdir(), 'construct-hooks-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env });
  const commit = (dir: string, message: string) => spawnSync('git', ['-C', dir, 'commit', '-q', '-m', message], { encoding: 'utf8', env });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  mkdirSync(join(root, 'scripts', 'hooks'), { recursive: true });
  mkdirSync(join(root, '.githooks'));
  for (const hook of readdirSync(join(REPO, '.githooks'))) copyFileSync(join(REPO, '.githooks', hook), join(root, '.githooks', hook));
  copyFileSync(join(REPO, 'scripts', 'install-git-hooks.sh'), join(root, 'scripts', 'install-git-hooks.sh'));
  copyFileSync(join(REPO, 'scripts', 'hooks', 'commit-trailers.mjs'), join(root, 'scripts', 'hooks', 'commit-trailers.mjs'));
  writeFileSync(join(root, 'scripts', 'hooks', 'secret-scan.mjs'), secretScan);
  writeFileSync(join(root, 'scripts', 'hooks', 'repo-gate.mjs'), 'process.exit(0);\n');
  git('add', '.');
  git('commit', '-q', '-m', 'initial');
  const install = () => execFileSync('bash', [join(root, 'scripts', 'install-git-hooks.sh')], { cwd: root, env, encoding: 'utf8' });
  install();
  return { root, env, git, commit, install, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('the installer points each checkout at its own .githooks, per worktree, and verifies what git resolves', () => {
  const s = scratch();
  try {
    assert.equal(s.git('config', '--worktree', '--get', 'core.hooksPath').trim(), '.githooks');
    assert.equal(
      spawnSync('git', ['-C', s.root, 'config', '--local', '--get', 'core.hooksPath'], { env: s.env }).status,
      1,
      'never repository-wide',
    );
    assert.equal(s.git('rev-parse', '--git-path', 'hooks').trim(), '.githooks');
  } finally {
    s.cleanup();
  }
});

test('an existing per-worktree hooks path is replaced, and a checkout without .githooks keeps its gate', () => {
  const s = scratch();
  const old = join(s.root, '..', `${s.root.split('/').pop()!}-old`);
  try {
    s.git('config', '--worktree', 'core.hooksPath', '/somewhere/else/hooks');
    s.git('checkout', '-q', '-b', 'before-githooks');
    s.git('rm', '-rq', '.githooks');
    s.git('commit', '-q', '-m', 'a branch from before .githooks existed');
    s.git('checkout', '-q', 'main');
    s.git('worktree', 'add', '-q', old, 'before-githooks');
    execFileSync('git', ['-C', old, 'config', '--worktree', 'core.hooksPath', '/main/checkout/.beads/hooks'], { env: s.env });
    const report = s.install();
    assert.equal(s.git('rev-parse', '--git-path', 'hooks').trim(), '.githooks', 'the stale override is gone');
    assert.match(report, /kept: .*-old has no \.githooks yet; it still resolves \/main\/checkout\/\.beads\/hooks/);
    assert.equal(
      execFileSync('git', ['-C', old, 'config', '--get', 'core.hooksPath'], { env: s.env, encoding: 'utf8' }).trim(),
      '/main/checkout/.beads/hooks',
    );
  } finally {
    rmSync(old, { recursive: true, force: true });
    s.cleanup();
  }
});

test('a failing secret scan blocks the commit, and a passing one lets it through', () => {
  const blocked = scratch('process.exit(1);\n');
  try {
    writeFileSync(join(blocked.root, 'a.txt'), 'a\n');
    blocked.git('add', 'a.txt');
    assert.notEqual(blocked.commit(blocked.root, 'add a').status, 0);
  } finally {
    blocked.cleanup();
  }
  const open = scratch();
  try {
    writeFileSync(join(open.root, 'a.txt'), 'a\n');
    open.git('add', 'a.txt');
    assert.equal(open.commit(open.root, 'add a').status, 0);
  } finally {
    open.cleanup();
  }
});

test('an attribution trailer is refused by the commit-msg hook', () => {
  const s = scratch();
  try {
    writeFileSync(join(s.root, 'b.txt'), 'b\n');
    s.git('add', 'b.txt');
    const result = s.commit(s.root, 'add b\n\nCo-Authored-By: Someone <someone@example.invalid>');
    const log = s.git('log', '-1', '--format=%B');
    assert.ok(result.status !== 0 || !/Co-Authored-By/i.test(log), 'the trailer never lands in history');
  } finally {
    s.cleanup();
  }
});

test('a linked worktree runs the hooks of its own checkout', () => {
  const s = scratch();
  const linked = join(s.root, '..', `${s.root.split('/').pop()!}-linked`);
  try {
    s.git('worktree', 'add', '-q', linked);
    s.install();
    writeFileSync(join(linked, 'scripts', 'hooks', 'secret-scan.mjs'), 'process.exit(1);\n');
    writeFileSync(join(linked, 'c.txt'), 'c\n');
    execFileSync('git', ['-C', linked, 'add', '.'], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
    assert.notEqual(s.commit(linked, 'add c').status, 0, "the worktree's own failing scan ran");
  } finally {
    rmSync(linked, { recursive: true, force: true });
    s.cleanup();
  }
});
