/**
 * tests/cli/git-guard.test.ts — the opt-in pre-commit guard, against real git.
 *
 * Installed, it warns when a staged file is reserved by other work in the
 * same checkout, and the commit goes through regardless. It says nothing for
 * a reservation in another worktree, when switched off, or when it cannot
 * find Construct. A pre-commit hook that was already there keeps running
 * after it, and uninstalling puts that hook back byte for byte. A hooks
 * directory inside a working tree is left alone.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sterile, type SterileFixture } from '../harness/sterile.ts';
import { openStateStore } from '../../src/kernel/state/open.ts';
import { claimWork, createWork } from '../../src/kernel/work/service.ts';
import { envFor as baseEnv, LAUNCHER } from '../concurrency/support.ts';

function envFor(fx: SterileFixture, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return baseEnv(fx, {
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_CONFIG_NOSYSTEM: '1',
    ...extra,
  });
}

function run(fx: SterileFixture, cwd: string, cmd: string, args: readonly string[], extra: NodeJS.ProcessEnv = {}): { status: number | null; out: string; err: string } {
  const r = spawnSync(cmd, [...args], { cwd, env: envFor(fx, extra), encoding: 'utf8' });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

function cli(fx: SterileFixture, cwd: string, args: readonly string[]): { status: number | null; out: string; err: string } {
  return run(fx, cwd, process.execPath, [LAUNCHER, ...args]);
}

function commit(fx: SterileFixture, cwd: string, file: string, extra: NodeJS.ProcessEnv = {}): { status: number | null; err: string } {
  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, file), `// ${String(Math.random())}\n`);
  assert.equal(run(fx, cwd, 'git', ['add', file]).status, 0);
  return run(fx, cwd, 'git', ['commit', '-q', '-m', `touch ${file}`], extra);
}

test('the git guard warns about a reserved staged file, never blocks, chains the earlier hook, and uninstalls to the original bytes', { timeout: 120_000 }, () => {
  const fx = sterile();
  try {
    const main = join(fx.root, 'repo');
    mkdirSync(main, { recursive: true });
    mkdirSync(join(fx.root, 'home'), { recursive: true });
    assert.equal(run(fx, main, 'git', ['init', '-q', '-b', 'main']).status, 0);
    writeFileSync(join(main, '.gitignore'), 'lanes/\n');
    assert.equal(cli(fx, main, ['init', '--no-wire', '--name=guarded', '--scale=solo']).status, 0);
    assert.equal(run(fx, main, 'git', ['add', '.']).status, 0);
    assert.equal(run(fx, main, 'git', ['commit', '-q', '-m', 'start']).status, 0);

    const hooks = join(main, '.git', 'hooks');
    const log = join(fx.root, 'chained.log');
    const original = `#!/bin/sh\necho ran >> '${log}'\n`;
    writeFileSync(join(hooks, 'pre-commit'), original, { mode: 0o755 });

    const installed = cli(fx, main, ['hooks', 'install', '--git']);
    assert.equal(installed.status, 0, installed.err);
    assert.match(installed.out, /installed the git guard/);
    assert.match(installed.out, /earlier pre-commit hook runs after it/);
    assert.equal(readFileSync(join(hooks, 'pre-commit.construct-chained'), 'utf8'), original);
    assert.match(cli(fx, main, ['hooks', 'list']).out, /git guard {2}intact/);
    assert.match(cli(fx, main, ['hooks', 'install', '--git']).out, /already installed/, 'installing again changes nothing');

    const store = openStateStore(join(main, '.construct', 'state', 'construct.sqlite'));
    try {
      const at = new Date().toISOString();
      createWork(store, { id: 'w-peer', kind: 'task', title: 'peer work', description: 'x', at, actor: 'test' });
      claimWork(store, { id: 'w-peer', owner: 'ses_peer/main', session: 'ses_peer', until: new Date(Date.now() + 3_600_000).toISOString(), now: at, paths: ['src/held.ts'] });
    } finally {
      store.close();
    }

    const warned = commit(fx, main, 'src/held.ts');
    assert.equal(warned.status, 0, 'the commit goes through');
    assert.match(warned.err, /construct: reserved here: src\/held\.ts is under src\/held\.ts, held by ses_peer\/main for w-peer/);
    assert.equal(readFileSync(log, 'utf8'), 'ran\n', 'the earlier hook ran after the guard');

    const clear = commit(fx, main, 'src/free.ts');
    assert.equal(clear.status, 0);
    assert.doesNotMatch(clear.err, /construct:/, 'nothing to say for an unreserved file');

    const off = commit(fx, main, 'src/held.ts', { CONSTRUCT_HOOKS: 'off' });
    assert.equal(off.status, 0);
    assert.doesNotMatch(off.err, /construct:/);

    const lane = join(main, 'lanes', 'b');
    assert.equal(run(fx, main, 'git', ['worktree', 'add', '-q', '-b', 'lane-b', lane]).status, 0);
    const fromLane = commit(fx, lane, 'src/held.ts');
    assert.equal(fromLane.status, 0);
    assert.doesNotMatch(fromLane.err, /construct:/, 'another worktree has its own copy: no collision to warn about');

    rmSync(join(main, '.construct', 'state', 'launcher'));
    const lost = commit(fx, main, 'src/held.ts');
    assert.equal(lost.status, 0, 'a guard that cannot find Construct stays quiet');
    assert.doesNotMatch(lost.err, /construct:/);

    const removed = cli(fx, main, ['hooks', 'uninstall', '--git']);
    assert.equal(removed.status, 0, removed.err);
    assert.match(removed.out, /removed the git guard\nrestored the earlier pre-commit hook/);
    assert.equal(readFileSync(join(hooks, 'pre-commit'), 'utf8'), original);
    assert.equal(statSync(join(hooks, 'pre-commit')).mode & 0o777, 0o755);
    assert.equal(existsSync(join(hooks, 'pre-commit.construct-chained')), false);
    assert.match(cli(fx, main, ['hooks', 'list']).out, /no hooks installed here/);
  } finally {
    fx.cleanup();
  }
});

test('a hooks directory inside a working tree is committed configuration, and the guard leaves it alone', { timeout: 60_000 }, () => {
  const fx = sterile();
  try {
    const main = join(fx.root, 'repo');
    mkdirSync(join(main, 'tools', 'hooks'), { recursive: true });
    mkdirSync(join(fx.root, 'home'), { recursive: true });
    assert.equal(run(fx, main, 'git', ['init', '-q', '-b', 'main']).status, 0);
    assert.equal(run(fx, main, 'git', ['config', 'core.hooksPath', 'tools/hooks']).status, 0);
    assert.equal(cli(fx, main, ['init', '--no-wire', '--name=managed', '--scale=solo']).status, 0);
    const refused = cli(fx, main, ['hooks', 'install', '--git']);
    assert.equal(refused.status, 1);
    assert.match(refused.err, /inside a working tree/);
    assert.match(refused.err, /construct work check --staged \|\| true/);
    assert.equal(existsSync(join(main, 'tools', 'hooks', 'pre-commit')), false);
  } finally {
    fx.cleanup();
  }
});
