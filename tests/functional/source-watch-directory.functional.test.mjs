/**
 * Functional test: cross-source watching for directory targets (bead
 * construct-wjap9.6).
 *
 * Verifies lib/sources/watch.mjs detects a content change inside a watched
 * directory target via its recursive hash map, and that refreshWatch persists
 * watch state + propagates the change to the staleness ledger.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { detectSourceChanges, refreshWatch, readWatchState, hashDirectory } from '../../lib/sources/watch.mjs';
import { readSourceLedger } from '../../lib/sources/staleness-ledger.mjs';

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

  // Rewriting with identical content yields the same hash.
  writeFile(dir, 'a.md', '# hello');
  assert.equal(hashDirectory(dir), h1);

  // Editing one file moves the hash.
  writeFile(dir, 'a.md', '# changed');
  assert.notEqual(hashDirectory(dir), h1);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('refreshWatch detects a directory change and records it in the ledger', () => {
  const projectRoot = makeTempDir();
  const dir = makeTempDir();
  writeFile(dir, 'note.md', 'v1');

  const target = { id: 'dir-1', provider: 'directory', selector: { path: dir } };

  // First refresh: no previous state, so not "changed" (baseline captured).
  const first = refreshWatch(target, { projectRoot });
  assert.equal(first.kind, 'directory');
  assert.equal(first.changed, false);
  assert.ok(first.current);

  const stateAfterFirst = readWatchState(target, { projectRoot });
  assert.equal(stateAfterFirst.lastSeenHash, first.current);
  assert.equal(stateAfterFirst.changedAt, null);

  // Mutate the directory tree.
  writeFile(dir, 'note.md', 'v2');

  const second = refreshWatch(target, { projectRoot });
  assert.equal(second.changed, true);
  assert.equal(second.previous, first.current);
  assert.equal(second.current, hashDirectory(dir));

  const stateAfterSecond = readWatchState(target, { projectRoot });
  assert.equal(stateAfterSecond.changedAt != null, true);

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
