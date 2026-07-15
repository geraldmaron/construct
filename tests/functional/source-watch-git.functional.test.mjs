/**
 * Functional test: cross-source watching for git (corpus) targets (bead
 * construct-wjap9.6).
 *
 * Verifies lib/sources/watch.mjs detects an upstream HEAD change via
 * `git ls-remote` against a local bare remote, and that refreshWatch persists
 * the new HEAD + propagates the change to the staleness ledger.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { refreshWatch, readWatchState } from '../../lib/sources/watch.mjs';
import { readSourceLedger } from '../../lib/sources/staleness-ledger.mjs';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(tmpdir(), prefix));
}

function git(workDir, args) {
  return execSync(`git -C "${workDir}" ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function initBareRemote() {
  const remote = makeTempDir('watch-remote-');
  git(remote, `init --bare -b main "${remote}"`.replace(`-C "${remote}" `, ''));
  return remote;
}

function makeCommit(workDir, message, fileName, contents) {
  fs.writeFileSync(path.join(workDir, fileName), contents);
  git(workDir, 'add -A');
  git(workDir, `commit -m "${message}"`);
}

test('refreshWatch detects a git remote HEAD change and records it', () => {
  const remote = makeTempDir('watch-remote-');
  git(remote, `init --bare -b main`);

  const work = makeTempDir('watch-work-');
  git(work, `init -b main`);
  git(work, 'config user.email test@example.com');
  git(work, 'config user.name test');
  makeCommit(work, 'first', 'file.txt', 'one');

  git(work, `remote add origin "${remote}"`);
  git(work, 'push -u origin main');

  const projectRoot = makeTempDir('watch-state-');
  const target = {
    id: 'git-1',
    provider: 'git',
    selector: { remote, content: { mode: 'corpus', ref: 'main' } },
  };

  // Baseline refresh: capture current HEAD, no change yet.
  const first = refreshWatch(target, { projectRoot });
  assert.equal(first.kind, 'git');
  assert.equal(first.changed, false);
  assert.match(first.current, /^[0-9a-f]{40}$/);

  const afterFirst = readWatchState(target, { projectRoot });
  assert.equal(afterFirst.lastSeenHead, first.current);
  assert.equal(afterFirst.changedAt, null);

  // Push a new commit upstream.
  makeCommit(work, 'second', 'file.txt', 'two');
  git(work, 'push origin main');

  const second = refreshWatch(target, { projectRoot });
  assert.equal(second.changed, true);
  assert.equal(second.previous, first.current);
  assert.notEqual(second.current, first.current);

  const ledger = readSourceLedger({ projectRoot });
  assert.ok(ledger.length >= 1);
  assert.equal(ledger[ledger.length - 1].targetId, 'git-1');
  assert.equal(ledger[ledger.length - 1].kind, 'git');
  assert.equal(ledger[ledger.length - 1].previous, first.current);
  assert.equal(ledger[ledger.length - 1].current, second.current);

  fs.rmSync(remote, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(projectRoot, { recursive: true, force: true });
});
