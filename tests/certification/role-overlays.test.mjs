/**
 * tests/certification/role-overlays.test.mjs — role overlay parity certification.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateAllRoleOverlays } from '../../lib/certification/role-overlays.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('all shipped role overlays pass parity checks', () => {
  const result = validateAllRoleOverlays({ rootDir: REPO });
  assert.equal(result.pass, true, result.errors.join('\n'));
  assert.ok(result.overlayCount >= 50);
  assert.deepEqual(result.classCoverage.sort(), ['architect', 'engineer', 'pm', 'qa', 'security']);
});
