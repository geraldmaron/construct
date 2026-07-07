/**
 * tests/certification/role-cards.test.mjs — specialist role card fixtures.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { validateRoleCards, writeRoleCards } from '../../lib/certification/role-cards.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('validateRoleCards passes for all registry specialists', () => {
  const result = validateRoleCards({ rootDir: REPO });
  assert.equal(result.pass, true, result.errors.join('\n'));
  // construct-rf26.11 consolidated the 29-specialist roster to 12 (orchestrator + 11 workers).
  assert.equal(result.count, 12);
});

test('writeRoleCards is idempotent', () => {
  const first = writeRoleCards({ rootDir: REPO });
  const second = writeRoleCards({ rootDir: REPO });
  assert.equal(first.count, second.count);
});
