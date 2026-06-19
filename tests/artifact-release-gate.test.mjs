/**
 * tests/artifact-release-gate.test.mjs — release gate runner.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArtifactRelease } from '../lib/artifact-release-gate.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('good PRD template passes structural gate', () => {
  const p = join(REPO, 'templates', 'docs', 'prd.md');
  const r = validateArtifactRelease({ filePath: p, type: 'prd', rootDir: REPO });
  assert.equal(r.ok, true, r.errors.join('; '));
});

test('unknown type fails closed', () => {
  const p = join(REPO, 'templates', 'docs', 'memo.md');
  const r = validateArtifactRelease({ filePath: p, type: 'not-a-type', rootDir: REPO });
  assert.equal(r.ok, false);
});
