/**
 * Functional test: cross-source watching for git (corpus) targets (bead.
 *
 * Verifies lib/sources/watch.mjs detects an upstream HEAD change via
 * `git ls-remote` against a local bare remote, and that refreshWatch persists
 * the new HEAD + propagates the change to the staleness ledger.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  refreshWatch,
  readWatchState,
  acknowledgeSourceChange,
} from '../../lib/sources/watch.mjs';
import { readSourceLedger } from '../../lib/sources/staleness-ledger.mjs';

const HOME_OVERRIDE = fs.mkdtempSync(path.join(tmpdir(), 'watch-git-home-'));
const PREV_HOME_OVERRIDE = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = HOME_OVERRIDE;
after(() => {
  if (PREV_HOME_OVERRIDE === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = PREV_HOME_OVERRIDE;
  fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
});

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(tmpdir(), prefix));
}

function git(workDir, args) {
  return execSync(`git -C "${workDir}" ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function makeCommit(workDir, message, fileName, contents) {
  fs.writeFileSync(path.join(workDir, fileName), contents);
  git(workDir, 'add -A');
  git(workDir, `commit -m "${message}"`);
}

test('refreshWatch detects a git remote HEAD change and records it', () => {
  const remote = makeTempDir('watch-remote-');
  git(remote, 'init --bare -b main');

  const work = makeTempDir('watch-work-');
  git(work, 'init -b main');
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

  const first = refreshWatch(target, { projectRoot });
  assert.equal(first.kind, 'git');
  assert.equal(first.changed, false);
  assert.match(first.current, /^[0-9a-f]{40}$/);

  const afterFirst = readWatchState(target, { projectRoot });
  assert.equal(afterFirst.lastSeenHead, first.current);
  assert.equal(afterFirst.changedAt, null);

  makeCommit(work, 'second', 'file.txt', 'two');
  git(work, 'push origin main');

  const second = refreshWatch(target, { projectRoot });
  assert.equal(second.changed, true);
  assert.equal(second.pending, true);
  assert.equal(second.previous, first.current);
  assert.notEqual(second.current, first.current);

  const afterSecond = readWatchState(target, { projectRoot });
  assert.equal(afterSecond.lastSeenHead, first.current);
  assert.equal(afterSecond.pendingHead, second.current);
  assert.equal(afterSecond.changedAt != null, true);

  const ack = acknowledgeSourceChange(target, { projectRoot });
  assert.equal(ack.lastSeenHead, second.current);
  assert.equal(ack.pendingHead, null);
  assert.equal(ack.changedAt, null);

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
