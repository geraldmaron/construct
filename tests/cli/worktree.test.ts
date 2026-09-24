/**
 * tests/cli/worktree.test.ts — one project, one store, across git worktrees.
 *
 * Parallel agents often work in linked git worktrees: nested inside the
 * repository (as Claude Code's .claude/worktrees/<name>) or beside it (as other
 * hosts do). Every worktree binds to the project in the main checkout and uses
 * its single store; the worktree becomes the session's lane. Nothing ever
 * creates a second store, removing a worktree loses nothing, and a worktree
 * that claims to be a different project is refused. A worktree of a submodule
 * binds to the submodule's checkout; a bare repository has no main checkout,
 * so its worktrees are refused rather than treated as projects of their own.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sterile, type SterileFixture } from '../harness/sterile.ts';
import { resolveRepository } from '../../src/cli/context.ts';

const LAUNCHER = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));

function envFor(fx: SterileFixture): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: join(fx.root, 'home'),
    XDG_CONFIG_HOME: fx.paths.configDir,
    XDG_STATE_HOME: fx.paths.stateDir,
    XDG_DATA_HOME: fx.paths.dataDir,
    XDG_CACHE_HOME: fx.paths.cacheDir,
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    NO_COLOR: '1',
  };
}

function sh(fx: SterileFixture, cwd: string, cmd: string, args: string[]): { status: number | null; out: string } {
  const r = spawnSync(cmd, args, { cwd, env: envFor(fx), encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function cli(fx: SterileFixture, cwd: string, args: string[]): { status: number | null; out: string } {
  return sh(fx, cwd, process.execPath, [LAUNCHER, ...args]);
}

function git(fx: SterileFixture, cwd: string, args: string[]): string {
  const r = sh(fx, cwd, 'git', args);
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.out}`);
  return r.out.trim();
}

/** A pattern matching a path however the temp directory is spelled (macOS /var or /private/var). */
function pathPattern(path: string): RegExp {
  return new RegExp(realpathSync(path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/^\/private/, '(?:/private)?'));
}

interface Repo {
  readonly main: string;
  readonly nested: string;
  readonly external: string;
  readonly db: string;
}

/** A repository with a Construct project and two linked worktrees. */
function repo(fx: SterileFixture, commitProjectFiles: boolean): Repo {
  const main = join(fx.root, 'repo');
  mkdirSync(main, { recursive: true });
  mkdirSync(join(fx.root, 'home'), { recursive: true });
  const git = (args: string[], cwd = main): void => {
    const r = sh(fx, cwd, 'git', args);
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.out}`);
  };
  git(['init', '-q', '-b', 'main']);
  writeFileSync(join(main, 'README.md'), '# Worktrees\n');
  writeFileSync(join(main, '.gitignore'), '.claude/worktrees/\n');
  assert.equal(cli(fx, main, ['init', '--no-wire', '--name=lanes', '--scale=solo']).status, 0);
  git(['add', 'README.md', '.gitignore', ...(commitProjectFiles ? ['.construct'] : [])]);
  git(['commit', '-q', '-m', 'start']);
  const nested = join(main, '.claude', 'worktrees', 'a');
  const external = join(fx.root, 'repo-b');
  git(['worktree', 'add', '-q', '-b', 'lane-a', nested]);
  git(['worktree', 'add', '-q', '-b', 'lane-b', external]);
  return { main, nested, external, db: join(main, '.construct', 'state', 'construct.sqlite') };
}

function titles(fx: SterileFixture, cwd: string): string[] {
  const r = cli(fx, cwd, ['work', 'list', '--json']);
  assert.equal(r.status, 0, r.out);
  const parsed = JSON.parse(r.out.trim().split('\n').pop()!) as { items?: Array<{ title: string }> } | Array<{ title: string }>;
  const items = Array.isArray(parsed) ? parsed : parsed.items ?? [];
  return items.map((i) => i.title).sort();
}

for (const committed of [true, false]) {
  test(`every worktree shares the main checkout's one store (.construct ${committed ? 'committed' : 'untracked'})`, () => {
    const fx = sterile();
    try {
      const r = repo(fx, committed);
      assert.equal(cli(fx, r.main, ['work', 'add', 'from main']).status, 0);
      assert.equal(cli(fx, r.nested, ['work', 'add', 'from nested lane']).status, 0);
      assert.equal(cli(fx, join(r.external), ['work', 'add', 'from external lane']).status, 0);
      const expected = ['from external lane', 'from main', 'from nested lane'];
      assert.deepEqual(titles(fx, r.main), expected);
      assert.deepEqual(titles(fx, r.nested), expected);
      assert.deepEqual(titles(fx, r.external), expected);
      for (const lane of [r.nested, r.external]) {
        assert.equal(existsSync(join(lane, '.construct', 'state', 'construct.sqlite')), false, `no store is created in ${lane}`);
      }
    } finally {
      fx.cleanup();
    }
  });
}

test('doctor in a worktree reports the shared project, and init there is refused and names the main checkout', () => {
  const fx = sterile();
  try {
    const r = repo(fx, true);
    const doctor = cli(fx, r.external, ['doctor']);
    assert.match(doctor.out, /ok\s+project: .*this session works in the worktree/);
    assert.doesNotMatch(doctor.out, /run `construct init`/);
    const refused = cli(fx, r.external, ['init', '--no-wire']);
    assert.notEqual(refused.status, 0);
    assert.match(refused.out, /git worktree of/);
    assert.match(refused.out, pathPattern(r.main));
    assert.equal(existsSync(join(r.external, '.construct', 'state')), false);
  } finally {
    fx.cleanup();
  }
});

test('removing a worktree loses nothing, and a store copied into a worktree is never used', () => {
  const fx = sterile();
  try {
    const r = repo(fx, true);
    assert.equal(cli(fx, r.external, ['work', 'add', 'made in lane b']).status, 0);
    mkdirSync(join(r.nested, '.construct', 'state'), { recursive: true });
    copyFileSync(r.db, join(r.nested, '.construct', 'state', 'construct.sqlite'));
    assert.equal(cli(fx, r.nested, ['work', 'add', 'made in lane a after the copy']).status, 0);
    assert.equal(sh(fx, r.main, 'git', ['worktree', 'remove', '--force', r.external]).status, 0);
    assert.deepEqual(titles(fx, r.main), ['made in lane a after the copy', 'made in lane b']);
  } finally {
    fx.cleanup();
  }
});

test('a worktree whose project file names a different project is refused', () => {
  const fx = sterile();
  try {
    const r = repo(fx, true);
    const file = join(r.external, '.construct', 'project.json');
    const project = JSON.parse(readFileSync(file, 'utf8')) as { id: string };
    writeFileSync(file, JSON.stringify({ ...project, id: 'proj-someone-else' }, null, 2));
    const refused = cli(fx, r.external, ['work', 'list']);
    assert.notEqual(refused.status, 0);
    assert.match(refused.out, /names project proj-someone-else/);
  } finally {
    fx.cleanup();
  }
});

interface BootstrapLane {
  readonly checkout: string;
  readonly branch: string | null;
  readonly head: string | null;
}

function bootstrapFrom(fx: SterileFixture, cwd: string, extra: string[] = []): Promise<{ root: string; lane: BootstrapLane | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [LAUNCHER, 'serve', '--client=claude-code', ...extra], { cwd, env: envFor(fx) });
    let buffer = '';
    child.stdout.on('data', (d) => {
      buffer += String(d);
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const msg = JSON.parse(line) as { id: number; result?: { structuredContent?: { construct?: { project?: { root: string; lane: BootstrapLane | null } } } } };
        if (msg.id !== 2) continue;
        child.stdin.end();
        const project = msg.result?.structuredContent?.construct?.project;
        if (!project) return reject(new Error(`no project in bootstrap: ${line}`));
        resolve(project);
      }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'lanes', version: '0' } } })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bootstrap', arguments: {} } })}\n`);
  });
}

test('a server started in a worktree binds the main store and reports its lane', { timeout: 60_000 }, async () => {
  const fx = sterile();
  try {
    const r = repo(fx, true);
    const fromLane = await bootstrapFrom(fx, r.external);
    assert.equal(realpathSync(fromLane.root), realpathSync(r.main));
    assert.equal(realpathSync(fromLane.lane!.checkout), realpathSync(r.external));
    assert.equal(fromLane.lane!.branch, 'lane-b');
    assert.equal(fromLane.lane!.head, git(fx, r.external, ['rev-parse', 'HEAD']), 'a lane on a branch reports the commit it is at');
    const pinned = await bootstrapFrom(fx, r.nested, [`--project=${r.main}`]);
    assert.equal(realpathSync(pinned.root), realpathSync(r.main));
    assert.equal(realpathSync(pinned.lane!.checkout), realpathSync(r.nested), 'a pinned --project still reports the worktree the session runs in');
    const main = await bootstrapFrom(fx, r.main);
    assert.equal(main.lane, null);
  } finally {
    fx.cleanup();
  }
});

test('worktrees of a bare repository are refused, never treated as projects of their own', () => {
  const fx = sterile();
  try {
    const r = repo(fx, true);
    const bare = join(fx.root, 'bare.git');
    git(fx, fx.root, ['clone', '-q', '--bare', r.main, bare]);
    const bareLane = join(fx.root, 'bare-lane');
    git(fx, bare, ['worktree', 'add', '-q', '-b', 'lane', bareLane]);
    // The .bare layout: a bare repository beside a .git file that points at it.
    const container = join(fx.root, 'container');
    mkdirSync(container);
    git(fx, fx.root, ['clone', '-q', '--bare', r.main, join(container, '.bare')]);
    writeFileSync(join(container, '.git'), 'gitdir: ./.bare\n');
    const containerLane = join(container, 'main');
    git(fx, container, ['worktree', 'add', '-q', containerLane]);

    for (const lane of [bareLane, containerLane]) {
      const found = resolveRepository(lane);
      assert.equal(found?.linked, true, lane);
      assert.equal(found?.bare, true, lane);
      assert.equal(found?.mainRoot, null, lane);
    }
    for (const dir of [bareLane, containerLane, container]) {
      for (const args of [['init', '--no-wire'], ['work', 'list']]) {
        const refused = cli(fx, dir, args);
        assert.notEqual(refused.status, 0, `${args.join(' ')} in ${dir}: ${refused.out}`);
        assert.match(refused.out, /bare/);
        assert.doesNotMatch(refused.out, /`construct init`/, 'the advice never sets up a store in a bare layout');
      }
      assert.equal(existsSync(join(dir, '.construct', 'state')), false, `no store is created in ${dir}`);
    }
  } finally {
    fx.cleanup();
  }
});

test('a worktree of a submodule binds to the submodule checkout; a separate git directory binds once it records its checkout', () => {
  const fx = sterile();
  try {
    const r = repo(fx, true);
    const superproject = join(fx.root, 'super');
    mkdirSync(superproject);
    git(fx, superproject, ['init', '-q', '-b', 'main']);
    git(fx, superproject, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', r.main, 'sub']);
    git(fx, superproject, ['commit', '-q', '-m', 'sub']);
    const sub = join(superproject, 'sub');
    assert.equal(resolveRepository(sub)?.linked, false, 'the submodule checkout itself is a main checkout');
    assert.equal(cli(fx, sub, ['init', '--no-wire']).status, 0);
    assert.equal(cli(fx, sub, ['work', 'add', 'in the submodule']).status, 0);
    const subLane = join(fx.root, 'sub-lane');
    git(fx, sub, ['worktree', 'add', '-q', '-b', 'lane', subLane]);
    assert.equal(realpathSync(resolveRepository(subLane)!.mainRoot!), realpathSync(sub));
    assert.deepEqual(titles(fx, subLane), ['in the submodule']);
    const init = cli(fx, subLane, ['init', '--no-wire']);
    assert.notEqual(init.status, 0);
    assert.match(init.out, pathPattern(sub));
    assert.equal(existsSync(join(subLane, '.construct', 'state')), false);

    const separate = join(fx.root, 'separate');
    git(fx, fx.root, ['clone', '-q', `--separate-git-dir=${join(fx.root, 'separate.git')}`, r.main, separate]);
    assert.equal(cli(fx, separate, ['init', '--no-wire']).status, 0);
    assert.equal(cli(fx, separate, ['work', 'add', 'in the separate clone']).status, 0);
    const separateLane = join(fx.root, 'separate-lane');
    git(fx, separate, ['worktree', 'add', '-q', '-b', 'lane', separateLane]);
    const unrecorded = cli(fx, separateLane, ['work', 'list']);
    assert.notEqual(unrecorded.status, 0, unrecorded.out);
    assert.match(unrecorded.out, /does not record where its main checkout is/);
    assert.match(unrecorded.out, /core\.worktree/);
    assert.equal(existsSync(join(separateLane, '.construct', 'state')), false);
    git(fx, separate, ['config', 'core.worktree', separate]);
    assert.deepEqual(titles(fx, separateLane), ['in the separate clone']);
  } finally {
    fx.cleanup();
  }
});

test('a lane on a branch reports its commit from a loose or a packed ref', () => {
  const fx = sterile();
  try {
    const r = repo(fx, true);
    const head = git(fx, r.external, ['rev-parse', 'HEAD']);
    assert.equal(resolveRepository(r.external)?.head, head);
    git(fx, r.main, ['pack-refs', '--all']);
    assert.equal(existsSync(join(r.main, '.git', 'refs', 'heads', 'lane-b')), false, 'the branch now lives only in packed-refs');
    assert.equal(resolveRepository(r.external)?.head, head);
  } finally {
    fx.cleanup();
  }
});

test('a worktree with a relative gitdir pointer is linked even when reached through a symlink', () => {
  const fx = sterile();
  try {
    const r = repo(fx, true);
    // What `git worktree add --relative-paths` writes: a pointer relative to the worktree's real location.
    const gitDir = realpathSync(join(r.main, '.git', 'worktrees', 'repo-b'));
    writeFileSync(join(r.external, '.git'), `gitdir: ${relative(realpathSync(r.external), gitDir)}\n`);
    assert.equal(git(fx, r.external, ['rev-parse', '--abbrev-ref', 'HEAD']), 'lane-b', 'git still reads the rewritten pointer');
    const alias = join(fx.root, 'aliases', 'lane');
    mkdirSync(dirname(alias));
    symlinkSync(r.external, alias);
    const found = resolveRepository(alias);
    assert.equal(found?.linked, true);
    assert.equal(realpathSync(found!.mainRoot!), realpathSync(r.main));
    const described = cli(fx, fx.root, ['serve', '--describe', '--client=claude-code', `--project=${alias}`]);
    assert.equal(described.status, 0, described.out);
    assert.match(described.out, new RegExp(`bound to ${pathPattern(r.main).source}\\s`));
  } finally {
    fx.cleanup();
  }
});
