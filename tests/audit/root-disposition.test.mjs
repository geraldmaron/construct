/**
 * tests/audit/root-disposition.test.mjs — repository-root ownership contract.
 *
 * Keeps every tracked root, published package entry, and present local root artifact
 * classified. Cleanup candidates require evidence across imports, dynamic lookup,
 * package contents, and tests; unproven local state remains protected from deletion.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  rootDispositionFindings,
  rootDispositionReport,
} from '../../scripts/audit/03c-root-layout.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('every tracked root, package allowlist entry, and present local root entry has a disposition', () => {
  const report = rootDispositionReport(ROOT);

  assert.equal(report.trackedRoots.length, report.manifest.trackedRoots.length);
  assert.equal(report.packageFiles.length, report.manifest.packageFiles.length);
  assert.deepEqual(report.unclassifiedTrackedRoots, []);
  assert.deepEqual(report.staleTrackedRootRows, []);
  assert.deepEqual(report.unclassifiedPackageFiles, []);
  assert.deepEqual(report.stalePackageFileRows, []);
  assert.deepEqual(report.unclassifiedLocalEntries, []);
  assert.deepEqual(report.invalidRows, []);
  assert.deepEqual(rootDispositionFindings(ROOT), []);
});

test('delete, relocate, and merge candidates carry all four kinds of proof', () => {
  const { manifest } = rootDispositionReport(ROOT);
  const candidates = [
    ...manifest.trackedRoots,
    ...manifest.packageFiles,
    ...manifest.localRootRules,
  ].filter((row) => ['delete', 'relocate', 'merge'].includes(row.action));

  assert.ok(candidates.length > 0, 'the matrix must expose cleanup candidates, not classify everything retain');
  for (const row of candidates) {
    assert.deepEqual(
      Object.keys(row.candidateEvidence).sort(),
      ['dynamicLookups', 'npmPack', 'staticImports', 'tests'],
      `${row.path ?? row.pattern} must cover every proof channel`,
    );
  }
});

test('unproven local state is explicitly protected from deletion', () => {
  const { manifest } = rootDispositionReport(ROOT);
  const protectedPaths = ['.DS_Store', '.construct', '2026-07-06-183146-check-the-pending-beads-and-the-last-branch-cont.txt', 'projects'];

  for (const pattern of protectedPaths) {
    const row = manifest.localRootRules.find((candidate) => candidate.pattern === pattern);
    assert.ok(row, `missing local-root ownership row for ${pattern}`);
    assert.equal(row.ownership, 'unproven');
    assert.equal(row.removalAuthorized, false);
  }
});

test('the disposition matrix is itself tracked under the owned scripts root', () => {
  const matrix = path.join(ROOT, 'scripts', 'audit', 'root-disposition.json');
  assert.equal(fs.existsSync(matrix), true);
  assert.equal(JSON.parse(fs.readFileSync(matrix, 'utf8')).version, 1);
});
