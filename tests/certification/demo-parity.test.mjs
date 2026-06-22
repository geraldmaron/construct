/**
 * tests/certification/demo-parity.test.mjs — cross-surface demo parity report.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDemoParityReport } from '../../lib/certification/demo-parity.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('canonical demos pass cross-surface parity probes', () => {
  const report = buildDemoParityReport({ rootDir: REPO });
  assert.equal(report.pass, true, JSON.stringify(report.mismatches, null, 2));
  assert.ok(report.acceptableDivergences.length >= 2);
});
