/**
 * tests/certification/worker-profile-cards.test.mjs — Worker Profile role card fixtures.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { validateWorkerProfileCards, writeWorkerProfileCards } from '../../lib/certification/worker-profile-cards.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('validateWorkerProfileCards passes for all registry profiles', () => {
  const result = validateWorkerProfileCards({ rootDir: REPO });
  assert.equal(result.pass, true, result.errors.join('\n'));
  // A consolidation reduced the 29-specialist roster to 12 (orchestrator + 11 workers).
  assert.equal(result.count, 12);
});

test('writeWorkerProfileCards is idempotent', () => {
  const first = writeWorkerProfileCards({ rootDir: REPO });
  const second = writeWorkerProfileCards({ rootDir: REPO });
  assert.equal(first.count, second.count);
});
