/**
 * tests/scripts/lint-lockfile-version.test.ts — package.json's version and
 * package-lock.json's own recorded version have to agree, checked at both
 * places the lockfile writes it (the top-level field and the root package
 * entry npm also stamps).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error — the script is plain .mjs, deliberately outside src/
import { versionMismatch } from '../../scripts/lint-lockfile-version.mjs';

test('versionMismatch is null when package.json and both lockfile copies agree', () => {
  const pkg = { version: '1.2.3' };
  const lock = { version: '1.2.3', packages: { '': { version: '1.2.3' } } };
  assert.equal(versionMismatch(pkg, lock), null);
});

test('versionMismatch reports the drift when the lockfile is behind', () => {
  const pkg = { version: '1.2.3' };
  const lock = { version: '1.2.2', packages: { '': { version: '1.2.2' } } };
  const mismatch = versionMismatch(pkg, lock);
  assert.ok(mismatch);
  assert.equal(mismatch.pkgVersion, '1.2.3');
  assert.equal(mismatch.lockVersion, '1.2.2');
  assert.equal(mismatch.lockRootVersion, '1.2.2');
});

test('versionMismatch catches the root package entry drifting alone', () => {
  const pkg = { version: '1.2.3' };
  const lock = { version: '1.2.3', packages: { '': { version: '1.2.2' } } };
  assert.ok(versionMismatch(pkg, lock));
});

test('versionMismatch tolerates a lockfile with no root package entry, checking only the top-level field', () => {
  const pkg = { version: '1.2.3' };
  const lock = { version: '1.2.2', packages: {} };
  const mismatch = versionMismatch(pkg, lock);
  assert.ok(mismatch);
  assert.equal(mismatch.lockRootVersion, undefined);
});

test('the repo itself has no drift — this is what the lint asserts at commit time', async () => {
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  assert.equal(versionMismatch(pkg, lock), null);
});
