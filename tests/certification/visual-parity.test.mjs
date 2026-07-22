/**
 * tests/certification/visual-parity.test.mjs — visual surface certification (construct-tsyfe.4.8).
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildVisualParityReport,
  scanDiagramEngineSpawns,
  validateVisualParityCertification,
} from '../../lib/certification/visual-parity.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('visual parity report passes on the current repo tree', () => {
  const report = buildVisualParityReport({ rootDir: REPO });
  assert.equal(report.pass, true, JSON.stringify(report.mismatches, null, 2));
});

test('diagram engine spawns stay inside consolidated provider modules', () => {
  const violations = scanDiagramEngineSpawns(REPO);
  assert.deepEqual(violations, [], JSON.stringify(violations, null, 2));
});

test('validateVisualParityCertification exits semantics are pass/fail', () => {
  const result = validateVisualParityCertification({ rootDir: REPO });
  assert.equal(result.pass, true, result.errors.join('\n'));
  assert.ok(result.report.schema.includes('visual-parity'));
});
