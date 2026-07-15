/**
 * tests/functional/source-target-git.functional.test.mjs
 *
 * construct-wjap9.1 (P1.1): the generic `git` source-target provider —
 * unlike `github`, its selector field IS the remote itself (no
 * remoteTemplate), so resolveCorpusRemote's fallback branch
 * (lib/sources/repo-cache.mjs) is what makes this provider resolvable at
 * all. Exercises the real `bin/construct` binary in a mkdtemp project
 * against a local `file://` bare repo — no network — mirroring
 * source-target-directory.functional.test.mjs's github-corpus test.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');

const dirs = [];
function freshDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

function makeBareRepo() {
  const src = freshDir('cx-git-src-');
  git(src, ['init', '-q', '-b', 'main']);
  git(src, ['config', 'user.email', 'test@construct.dev']);
  git(src, ['config', 'user.name', 'Construct Test']);
  fs.writeFileSync(path.join(src, 'README.md'), '# Docs\nCorpus root readme.\n');
  git(src, ['add', '-A']);
  git(src, ['commit', '-qm', 'init']);
  const bare = freshDir('cx-git-bare-');
  execFileSync('git', ['clone', '-q', '--bare', src, bare], { stdio: ['ignore', 'ignore', 'ignore'] });
  return `file://${bare}`;
}

function runCx(cwd, args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, HOME: cwd, USERPROFILE: cwd, GITHUB_TOKEN: '', GH_TOKEN: '' },
  });
}

function projectDir() {
  return freshDir('cx-git-proj-');
}

test('git target: selector.remote (no content.remote override) resolves via the fallback branch and clones', () => {
  const cwd = projectDir();
  const bareUrl = makeBareRepo();
  const selector = { remote: bareUrl, content: { mode: 'corpus', ref: 'main' } };

  const add = runCx(cwd, ['sources', 'add', 'git', 'platform-docs', JSON.stringify(selector)]);
  assert.equal(add.status, 0, `add failed: ${add.stderr}`);

  const sync1 = runCx(cwd, ['sources', 'sync', 'platform-docs']);
  assert.equal(sync1.status, 0, `sync1 failed: ${sync1.stderr}`);
  assert.match(sync1.stdout, /synced platform-docs \(clone\)/);

  const stateProjects = path.join(cwd, '.construct', 'projects');
  const keys = fs.readdirSync(stateProjects);
  assert.equal(keys.length, 1, 'one project key under the state root');
  const cacheDir = path.join(stateProjects, keys[0], 'context-repos', 'platform-docs');
  assert.ok(fs.existsSync(path.join(cacheDir, '.git')), 'clone populated .git');
  assert.ok(fs.existsSync(path.join(cacheDir, 'README.md')), 'clone populated content');

  const gitMtimeBefore = fs.statSync(path.join(cacheDir, '.git')).birthtimeMs;
  const sync2 = runCx(cwd, ['sources', 'sync', 'platform-docs']);
  assert.equal(sync2.status, 0, `sync2 failed: ${sync2.stderr}`);
  assert.match(sync2.stdout, /synced platform-docs \(fetch\)/, 'second sync fetches, does not re-clone');
  assert.equal(fs.statSync(path.join(cacheDir, '.git')).birthtimeMs, gitMtimeBefore, '.git dir reused, not recreated');

  const list = runCx(cwd, ['sources', 'list']);
  assert.match(list.stdout, /platform-docs · git .* corpus\(main\)/);
});

test('git target: a ~-prefixed local remote is expanded before cloning', () => {
  const cwd = projectDir();
  const bareUrl = makeBareRepo();
  const bareRealPath = bareUrl.replace(/^file:\/\//, '');

  // Substitute the real home for `~` the same way a user's config would name
  // a local bare repo relative to their own $HOME, then set HOME so the
  // tilde in the selector value resolves to the same real path.
  const homeDir = path.dirname(bareRealPath);
  const bareName = path.basename(bareRealPath);
  const selector = { remote: `~/${bareName}`, content: { mode: 'corpus', ref: 'main' } };

  const add = spawnSync(process.execPath, [BIN, 'sources', 'add', 'git', 'local-repo', JSON.stringify(selector)], {
    cwd, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
  });
  assert.equal(add.status, 0, `add failed: ${add.stderr}`);

  const sync = spawnSync(process.execPath, [BIN, 'sources', 'sync', 'local-repo'], {
    cwd, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
  });
  assert.equal(sync.status, 0, `sync failed: ${sync.stderr}`);
  assert.match(sync.stdout, /synced local-repo \(clone\)/, 'tilde-expanded remote resolved and cloned');
});

test('resolveCorpusRemote: a git target with no content.remote falls back to the expanded selector value', async () => {
  const { resolveCorpusRemote } = await import('../../lib/sources/repo-cache.mjs');
  const remote = resolveCorpusRemote({
    id: 'g', provider: 'git', selector: { remote: 'git@host:owner/repo.git', content: { mode: 'corpus' } },
  });
  assert.equal(remote, 'git@host:owner/repo.git');
});

test('resolveCorpusRemote: an explicit content.remote override still wins for a git target', async () => {
  const { resolveCorpusRemote } = await import('../../lib/sources/repo-cache.mjs');
  const remote = resolveCorpusRemote({
    id: 'g', provider: 'git',
    selector: { remote: 'git@host:owner/repo.git', content: { mode: 'corpus', remote: 'file:///explicit/override' } },
  });
  assert.equal(remote, 'file:///explicit/override');
});
