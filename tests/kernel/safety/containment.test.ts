/**
 * tests/kernel/safety/containment.test.ts — path containment refuses escapes
 * and oversized reads, and follows only inside-root links.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectContained, readContainedFile, ContainmentError } from '../../../src/kernel/safety/containment.ts';

function tmp(): { root: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'construct-contain-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('an intermediate symlink that leaves the root is refused', () => {
  const { root, cleanup } = tmp();
  try {
    const outside = mkdtempSync(join(tmpdir(), 'construct-out-'));
    writeFileSync(join(outside, 'secret.txt'), 'secret', 'utf8');
    mkdirSync(join(root, 'docs'));
    symlinkSync(outside, join(root, 'docs', 'escape'));
    const v = inspectContained(root, 'docs/escape/secret.txt');
    assert.equal(v.ok, false);
    if (!v.ok) assert.match(v.reason, /escapes|outside/);
    rmSync(outside, { recursive: true, force: true });
  } finally {
    cleanup();
  }
});

test('a file symlink that stays inside is readable and flagged', () => {
  const { root, cleanup } = tmp();
  try {
    writeFileSync(join(root, 'real.md'), 'hello', 'utf8');
    symlinkSync(join(root, 'real.md'), join(root, 'link.md'));
    const read = readContainedFile(root, 'link.md', 100);
    assert.ok(read);
    assert.equal(read!.viaSymlink, true);
    assert.equal(read!.bytes.toString('utf8'), 'hello');
  } finally {
    cleanup();
  }
});

test('oversized files are truncated at the cap', () => {
  const { root, cleanup } = tmp();
  try {
    writeFileSync(join(root, 'big.txt'), 'abcdefghij', 'utf8');
    const read = readContainedFile(root, 'big.txt', 4);
    assert.equal(read!.truncated, true);
    assert.equal(read!.bytes.length, 4);
  } finally {
    cleanup();
  }
});

test('a path outside the root throws', () => {
  const { root, cleanup } = tmp();
  try {
    assert.throws(() => readContainedFile(root, '../outside', 10), ContainmentError);
  } finally {
    cleanup();
  }
});
