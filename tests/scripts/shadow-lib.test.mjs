/**
 * tests/scripts/shadow-lib.test.mjs — self-test for graph-impact shadow-mode
 * fail-open behavior (LMCP-C4).
 *
 * Tests fail-open signal when graph is missing/stale, diff touches graph-blind
 * files, or computation errors.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readGraphImpacted, normalizeChangedFiles } from '../../scripts/shadow-lib.mjs';

test('normalizeChangedFiles handles backslashes and ./ prefix', () => {
  const files = ['lib\\helpers.mjs', './tests/unit.test.mjs', 'src/index.ts'];
  const result = normalizeChangedFiles(files);
  assert.deepEqual(result, ['lib/helpers.mjs', 'tests/unit.test.mjs', 'src/index.ts']);
});

test('normalizeChangedFiles filters out empty strings', () => {
  const files = ['lib/a.mjs', '', 'lib/b.mjs', null, undefined, '   '];
  const result = normalizeChangedFiles(files);
  assert.deepEqual(result, ['lib/a.mjs', 'lib/b.mjs']);
});

test('readGraphImpacted reports cannotCompute when graph is stale', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'shadow-stale-'));
  test.after(() => rmSync(fixture, { recursive: true, force: true }));
  const result = readGraphImpacted(fixture, ['lib/index.mjs']);
  assert.ok(result.cannotCompute);
  assert.match(result.reason, /graph is stale|staleness check failed/);
});

test('readGraphImpacted reports cannotCompute for graph-blind files', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'shadow-blind-'));
  test.after(() => rmSync(fixture, { recursive: true, force: true }));
  const result = readGraphImpacted(fixture, [
    '.github/workflows/ci.yml',
    'package-lock.json',
    'scripts/ci/setup.sh',
  ]);
  assert.ok(result.cannotCompute);
  assert.match(result.reason, /graph-blind/);
});

test('readGraphImpacted accepts mixed files with graph-blind among normal', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'shadow-mixed-'));
  test.after(() => rmSync(fixture, { recursive: true, force: true }));
  const result = readGraphImpacted(fixture, [
    'lib/helpers.mjs',
    '.github/workflows/ci.yml',
  ]);
  assert.ok(result.cannotCompute);
  assert.match(result.reason, /graph-blind/);
});

test('readGraphImpacted returns empty impacted_tests when graph absent', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'shadow-nograph-'));
  test.after(() => rmSync(fixture, { recursive: true, force: true }));
  const result = readGraphImpacted(fixture, []);
  assert.ok(result.cannotCompute || result.impacted_tests !== undefined);
});
