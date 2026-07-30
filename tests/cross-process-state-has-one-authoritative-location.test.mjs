/**
 * tests/cross-process-state-has-one-authoritative-location.test.mjs
 * invariant: every project-identity call site resolves the same key.
 *
 * Three call sites answer "which project is this" — `lib/state-root.mjs`'s
 * `deriveProjectKey` (the canonical derivation), `lib/orchestration/store.mjs`'s
 * `projectKey`, and `lib/embed/daemon.mjs`'s `resolveRootDir`/`resolveProjectKey`
 * and they must agree for the same repo, with or without a git
 * remote, with or without a `.construct/context.md` marker, and under an
 * explicit `deployment.projectKey` override. Exercises real `git` fixtures
 * rather than stubs, since `deriveProjectKey` shells out to `git remote
 * get-url origin`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { deriveProjectKey } from '../lib/state-root.mjs';
import { projectKey } from '../lib/orchestration/store.mjs';
import { resolveRootDir, resolveProjectKey } from '../lib/embed/daemon.mjs';

const dirs = [];
function mkTmp(prefix = 'cx-identity-') {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

function initGitRepo(dir, { remote = null } = {}) {
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir });
}

function writeContextMarker(dir) {
  fs.mkdirSync(path.join(dir, '.construct'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.construct', 'context.md'), '# context\n');
}

test('a git repo with a remote and a context.md marker: all three call sites agree', () => {
  const repo = mkTmp();
  initGitRepo(repo, { remote: 'https://github.com/example/one-project.git' });
  writeContextMarker(repo);

  const canonical = deriveProjectKey(repo);
  assert.equal(projectKey({}, repo), canonical);
  assert.equal(resolveRootDir({}, repo), repo);
  assert.equal(resolveProjectKey({}, repo), canonical);
});

test('a git repo with a remote but no context.md marker: resolveRootDir falls through to the git toplevel, still agreeing', () => {
  const repo = mkTmp();
  initGitRepo(repo, { remote: 'https://github.com/example/two-project.git' });
  const nested = path.join(repo, 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });

  const canonical = deriveProjectKey(repo);
  assert.equal(projectKey({}, repo), canonical);
  assert.equal(fs.realpathSync(resolveRootDir({}, nested)), repo);
  assert.equal(resolveProjectKey({}, nested), canonical);
});

test('a local-only repo with no remote: the path-hash fallback still agrees across all three', () => {
  const repo = mkTmp();
  initGitRepo(repo);
  writeContextMarker(repo);

  const canonical = deriveProjectKey(repo);
  assert.equal(projectKey({}, repo), canonical);
  assert.equal(resolveProjectKey({}, repo), canonical);
});

test('two clones of the same remote share one key via projectKey, not two via raw cwd', () => {
  const remoteDir = mkTmp('cx-identity-remote-');
  execFileSync('git', ['init', '-q', '--bare'], { cwd: remoteDir });

  const cloneA = mkTmp('cx-identity-clone-a-');
  const cloneB = mkTmp('cx-identity-clone-b-');
  execFileSync('git', ['clone', '-q', remoteDir, cloneA]);
  execFileSync('git', ['clone', '-q', remoteDir, cloneB]);

  assert.equal(deriveProjectKey(cloneA), deriveProjectKey(cloneB));
  assert.equal(projectKey({}, cloneA), projectKey({}, cloneB));
  assert.notEqual(cloneA, cloneB);
});

test('an explicit deployment.projectKey override wins over the derivation for both projectKey and resolveProjectKey', () => {
  const repo = mkTmp();
  initGitRepo(repo, { remote: 'https://github.com/example/three-project.git' });
  writeContextMarker(repo);
  const config = { deployment: { projectKey: 'operator-chosen-key' } };

  assert.equal(projectKey(config, repo), 'operator-chosen-key');
  assert.equal(resolveProjectKey({}, repo, config), 'operator-chosen-key');
  assert.notEqual(deriveProjectKey(repo), 'operator-chosen-key');
});

test('a directory with no git repo and no context.md still falls back to homedir, unchanged from before', () => {
  const orphan = mkTmp();
  assert.equal(resolveRootDir({}, orphan), os.homedir());
});
