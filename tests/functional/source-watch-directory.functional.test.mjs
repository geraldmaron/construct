/**
 * Functional test: cross-source watching for directory targets (bead.
 *
 * Verifies lib/sources/watch.mjs detects a content change inside a watched
 * directory target via its recursive hash map, and that refreshWatch persists
 * watch state + propagates the change to the staleness ledger.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  detectSourceChanges,
  refreshWatch,
  readWatchState,
  hashDirectory,
  acknowledgeSourceChange,
} from '../../lib/sources/watch.mjs';
import { readSourceLedger } from '../../lib/sources/staleness-ledger.mjs';

const HOME_OVERRIDE = fs.mkdtempSync(path.join(tmpdir(), 'watch-dir-home-'));
const PREV_HOME_OVERRIDE = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = HOME_OVERRIDE;
after(() => {
  if (PREV_HOME_OVERRIDE === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = PREV_HOME_OVERRIDE;
  fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
});

function makeTempDir() {
  return fs.mkdtempSync(path.join(tmpdir(), 'watch-dir-'));
}

function writeFile(dir, name, contents) {
  fs.writeFileSync(path.join(dir, name), contents);
}

test('hashDirectory is stable for identical trees and moves on edit', () => {
  const dir = makeTempDir();
  writeFile(dir, 'a.md', '# hello');
  fs.mkdirSync(path.join(dir, 'sub'));
  writeFile(path.join(dir, 'sub'), 'b.md', 'world');
  const h1 = hashDirectory(dir);
  assert.match(h1, /^[0-9a-f]{16}$/);

  writeFile(dir, 'a.md', '# hello');
  assert.equal(hashDirectory(dir), h1);

  writeFile(dir, 'a.md', '# changed');
  assert.notEqual(hashDirectory(dir), h1);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('refreshWatch detects a directory change and records it in the ledger', () => {
  const projectRoot = makeTempDir();
  const dir = makeTempDir();
  writeFile(dir, 'note.md', 'v1');

  const target = { id: 'dir-1', provider: 'directory', selector: { path: dir } };

  const first = refreshWatch(target, { projectRoot });
  assert.equal(first.kind, 'directory');
  assert.equal(first.changed, false);
  assert.ok(first.current);

  const stateAfterFirst = readWatchState(target, { projectRoot });
  assert.equal(stateAfterFirst.lastSeenHash, first.current);
  assert.equal(stateAfterFirst.changedAt, null);

  writeFile(dir, 'note.md', 'v2');

  const second = refreshWatch(target, { projectRoot });
  assert.equal(second.changed, true);
  assert.equal(second.pending, true);
  assert.equal(second.previous, first.current);
  assert.equal(second.current, hashDirectory(dir));

  const stateAfterSecond = readWatchState(target, { projectRoot });
  assert.equal(stateAfterSecond.lastSeenHash, first.current);
  assert.equal(stateAfterSecond.pendingHash, second.current);
  assert.equal(stateAfterSecond.changedAt != null, true);

  const ack = acknowledgeSourceChange(target, { projectRoot });
  assert.equal(ack.lastSeenHash, second.current);
  assert.equal(ack.pendingHash, null);
  assert.equal(ack.changedAt, null);

  const ledger = readSourceLedger({ projectRoot });
  assert.ok(ledger.length >= 1);
  assert.equal(ledger[ledger.length - 1].targetId, 'dir-1');
  assert.equal(ledger[ledger.length - 1].kind, 'directory');

  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('detectSourceChanges reports unsupported for an unknown provider', () => {
  const projectRoot = makeTempDir();
  const result = detectSourceChanges({ id: 'x', provider: 'no-such-provider', selector: {} }, { projectRoot });
  assert.equal(result.kind, 'unsupported');
  assert.equal(result.changed, false);
  fs.rmSync(projectRoot, { recursive: true, force: true });
});
