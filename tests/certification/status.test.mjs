/**
 * tests/certification/status.test.mjs — certification status rollup.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCertificationStatus } from '../../lib/certification/status.mjs';
import { applyStaleImpact } from '../../lib/certification/stale-impact.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('buildCertificationStatus lists capabilities with never-run by default', () => {
  const report = buildCertificationStatus({ rootDir: REPO });
  assert.ok(report.capabilities.length > 0);
  // construct-rf26.11 consolidated the 29-specialist roster to 12 (orchestrator + 11 workers).
  assert.ok(report.specialists.length >= 12);
  assert.ok(report.skills.length > 0);
  assert.ok(report.artifactTypes.length > 0);
  assert.ok(report.documentCategories.length > 0);
  assert.ok(report.demos.length > 0);
});

test('buildCertificationStatus marks stale capabilities distinctly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-status-'));
  fs.mkdirSync(path.join(root, '.construct', 'certification'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests', 'capabilities'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests', 'certification', 'scenarios'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests', 'certification', 'skills'), { recursive: true });
  fs.copyFileSync(
    path.join(REPO, 'tests', 'capabilities', 'ledger.json'),
    path.join(root, 'tests', 'capabilities', 'ledger.json'),
  );
  fs.copyFileSync(
    path.join(REPO, 'tests', 'certification', 'scenarios', 'catalog.json'),
    path.join(root, 'tests', 'certification', 'scenarios', 'catalog.json'),
  );
  fs.copyFileSync(
    path.join(REPO, 'tests', 'certification', 'skills', 'inventory.json'),
    path.join(root, 'tests', 'certification', 'skills', 'inventory.json'),
  );
  fs.cpSync(path.join(REPO, 'registry'), path.join(root, 'registry'), { recursive: true });
  fs.copyFileSync(
    path.join(REPO, 'package.json'),
    path.join(root, 'package.json'),
  );
  applyStaleImpact({ rootDir: root, changedFiles: ['lib/artifact-release-gate.mjs'] });
  const report = buildCertificationStatus({ rootDir: root });
  const stale = report.capabilities.filter((c) => c.status === 'stale');
  assert.ok(stale.length > 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('buildCertificationStatus filters to one capability', () => {
  const report = buildCertificationStatus({
    rootDir: REPO,
    capabilityId: 'test-system.capability-ledger',
  });
  assert.equal(report.capability.id, 'test-system.capability-ledger');
  assert.ok(Array.isArray(report.scenarios));
});
