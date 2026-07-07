/**
 * tests/helpers/cleanup.test.mjs — Contract test for the rmTmpDir teardown helper.
 *
 * Locks in the three behaviors teardown code relies on: recursive removal of
 * tmpdir-rooted sandboxes (both the symlinked and realpath'd macOS forms),
 * loud refusal of any path outside os.tmpdir() (a mis-swept repo or HOME path
 * must fail, not vanish silently), and a no-op on falsy/missing input so
 * cleanup() can run unconditionally.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmTmpDir } from './cleanup.mjs';

test('removes a populated tmpdir sandbox recursively', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cleanup-contract-'));
  mkdirSync(join(dir, 'a', 'b'), { recursive: true });
  writeFileSync(join(dir, 'a', 'b', 'f.txt'), 'x');
  rmTmpDir(dir);
  assert.equal(existsSync(dir), false);
});

test('accepts the realpath form of the tmpdir root', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'cleanup-contract-real-'));
  rmTmpDir(dir);
  assert.equal(existsSync(dir), false);
});

test('is a no-op on falsy input and on an already-removed dir', () => {
  assert.doesNotThrow(() => rmTmpDir(null));
  assert.doesNotThrow(() => rmTmpDir(undefined));
  assert.doesNotThrow(() => rmTmpDir(join(tmpdir(), 'cleanup-contract-never-existed')));
});

test('refuses paths outside os.tmpdir() and the tmpdir root itself', () => {
  assert.throws(() => rmTmpDir(process.cwd()), /only removes paths under os\.tmpdir/);
  assert.throws(() => rmTmpDir(tmpdir()), /refuses to remove the tmpdir root/);
});
