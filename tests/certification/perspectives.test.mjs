/**
 * Perspective parity certification.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateAllPerspectives } from '../../lib/certification/perspectives.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('all shipped perspectives pass Worker Profile parity checks', () => {
  const result = validateAllPerspectives({ rootDir: REPO });
  assert.equal(result.pass, true, result.errors.join('\n'));
  assert.ok(result.perspectiveCount >= 38, 'canonical perspective coverage unexpectedly shrank');
  assert.deepEqual(result.perspectiveClassCoverage, ['architect', 'engineer', 'pm', 'qa', 'security']);
});
