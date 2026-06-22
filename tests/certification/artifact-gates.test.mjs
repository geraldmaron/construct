/**
 * tests/certification/artifact-gates.test.mjs — golden artifact gate matrix.
 *
 * @capability artifact.release-gate
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateAllGoldenArtifactGates, writeArtifactGateMatrixDoc } from '../../lib/certification/artifact-gates.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('all golden artifact fixtures pass release gates', () => {
  const result = validateAllGoldenArtifactGates({ rootDir: REPO });
  assert.equal(result.pass, true, result.errors.join('\n'));
  assert.ok(result.matrix.length > 0);
});

test('gate matrix doc is writable', () => {
  const out = writeArtifactGateMatrixDoc({ rootDir: REPO });
  assert.match(out, /gate-matrix\.json$/);
});
