/**
 * tests/certification/artifact-provenance.test.mjs — provenance and accessibility gates.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateAllArtifactProvenance } from '../../lib/certification/artifact-provenance.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('golden artifact fixtures pass provenance and structure checks', () => {
  const result = validateAllArtifactProvenance({ rootDir: REPO, strict: true });
  assert.equal(result.pass, true, result.errors.slice(0, 5).join('\n'));
});
