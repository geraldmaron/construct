/**
 * tests/package-exports.test.ts — the published package surface stays locked.
 *
 * Deep `./kernel/*` and `./hosts/*` exports were removed in the clean-slate
 * pass. This test fails if package.json reopens them by accident.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('package exports expose the root and bound reviewer contract, never deep paths', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    exports?: Record<string, unknown>;
    files?: string[];
  };
  assert.deepEqual(Object.keys(pkg.exports ?? {}).sort(), ['.', './reviewer']);
  assert.equal(pkg.exports?.['.'], './dist/kernel/index.js');
  assert.equal(pkg.exports?.['./reviewer'], './dist/hosts/semantic-observation.js');
  for (const key of Object.keys(pkg.exports ?? {})) {
    assert.equal(key.includes('kernel/'), false);
    assert.equal(key.includes('hosts/'), false);
  }
  assert.deepEqual(pkg.files?.slice().sort(), ['bin', 'dist', 'registry', 'skills', 'workflows']);
});
