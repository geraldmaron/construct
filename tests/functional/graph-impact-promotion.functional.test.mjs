/**
 * tests/functional/graph-impact-promotion.functional.test.mjs —
 * Multi-component proof: promotion metrics, aggregation
 * report, gating scaffold, and CI wiring.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  aggregatePromotionReport,
  computeArtifactMetrics,
  enforceNoOutlierFailures,
  PROMOTION_CRITERIA,
} from '../../scripts/shadow-lib.mjs';
import { buildPromotionReport } from '../../scripts/graph-impact-promotion-report.mjs';
import { runGraphImpactGate } from '../../scripts/graph-impact-gate.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function fixtureArtifact(overrides = {}) {
  return {
    timestamp: '2026-07-01T12:00:00.000Z',
    base_sha: 'abc123',
    changed_files: ['lib/example.mjs'],
    impacted_tests: ['tests/a.test.mjs', 'tests/b.test.mjs', 'tests/c.test.mjs'],
    all_tests_run: ['tests/a.test.mjs', 'tests/b.test.mjs', 'tests/c.test.mjs', 'tests/d.test.mjs'],
    failed_tests: ['tests/a.test.mjs'],
    outlier_failures: [],
    result: 'ok',
    ...overrides,
  };
}

test('computeArtifactMetrics matches hand-calculated recall and precision', () => {
  const metrics = computeArtifactMetrics(fixtureArtifact());
  assert.equal(metrics.recall, 1);
  assert.equal(metrics.precision, 1 / 3);
  assert.equal(metrics.true_positives, 1);
  assert.equal(metrics.false_negatives, 0);
  assert.equal(metrics.false_positives, 2);
});

test('computeArtifactMetrics handles outlier failures with zero recall', () => {
  const metrics = computeArtifactMetrics(fixtureArtifact({
    failed_tests: ['tests/d.test.mjs'],
    outlier_failures: ['tests/d.test.mjs'],
    result: 'outliers',
  }));
  assert.equal(metrics.recall, 0);
  assert.equal(metrics.outlier_count, 1);
});

test('aggregatePromotionReport returns not-promoted below threshold', () => {
  const artifacts = Array.from({ length: 5 }, (_, i) => fixtureArtifact({
    timestamp: `2026-07-${String(i + 1).padStart(2, '0')}T12:00:00.000Z`,
  }));
  const report = aggregatePromotionReport(artifacts, PROMOTION_CRITERIA, new Date('2026-07-20T00:00:00.000Z'));
  assert.equal(report.verdict, 'not-promoted');
  assert.equal(report.promoted, false);
  assert.ok(report.reasons.some((r) => r.includes('insufficient eligible runs')));
});

test('aggregatePromotionReport returns promoted at threshold with zero outliers', () => {
  const artifacts = Array.from({ length: 30 }, (_, i) => fixtureArtifact({
    timestamp: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
  }));
  const report = aggregatePromotionReport(artifacts, PROMOTION_CRITERIA, new Date('2026-07-20T00:00:00.000Z'));
  assert.equal(report.verdict, 'promoted');
  assert.equal(report.promoted, true);
  assert.equal(report.outlier_run_count, 0);
  assert.equal(report.aggregate_recall, 1);
});

test('aggregatePromotionReport stays not-promoted when outliers exist in window', () => {
  const artifacts = Array.from({ length: 30 }, (_, i) => fixtureArtifact({
    timestamp: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
    ...(i === 10 ? {
      failed_tests: ['tests/d.test.mjs'],
      outlier_failures: ['tests/d.test.mjs'],
      result: 'outliers',
    } : {}),
  }));
  const report = aggregatePromotionReport(artifacts, PROMOTION_CRITERIA, new Date('2026-07-20T00:00:00.000Z'));
  assert.equal(report.verdict, 'not-promoted');
  assert.ok(report.reasons.some((r) => r.includes('outlier runs')));
});

test('buildPromotionReport --json reads fixture history directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-history-'));
  test.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  fs.writeFileSync(path.join(dir, 'run-1.json'), JSON.stringify(fixtureArtifact(), null, 2));
  fs.writeFileSync(path.join(dir, 'run-2.json'), JSON.stringify(fixtureArtifact({
    timestamp: '2026-07-02T12:00:00.000Z',
    failed_tests: [],
    result: 'ok',
  }), null, 2));

  const report = buildPromotionReport({ dir, now: new Date('2026-07-20T00:00:00.000Z') });
  assert.equal(report.artifact_count, 2);
  assert.equal(report.verdict, 'not-promoted');
  assert.equal(typeof report.aggregate_recall, 'number');
});

test('runGraphImpactGate skips when promotion threshold is not met', () => {
  const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-history-'));
  test.after(() => { try { fs.rmSync(historyDir, { recursive: true, force: true }); } catch {} });

  fs.writeFileSync(path.join(historyDir, 'one.json'), JSON.stringify(fixtureArtifact(), null, 2));
  const result = runGraphImpactGate({
    projectDir: REPO_ROOT,
    historyDir,
    forceGating: false,
  });
  assert.equal(result.status, 0);
  assert.equal(result.mode, 'skipped');
});

test('enforceNoOutlierFailures fails loud on outlier artifact (gating opposite of shadow)', () => {
  const check = enforceNoOutlierFailures(fixtureArtifact({
    failed_tests: ['tests/d.test.mjs'],
    outlier_failures: ['tests/d.test.mjs'],
    result: 'outliers',
  }));
  assert.equal(check.ok, false);
  assert.deepEqual(check.outlier_failures, ['tests/d.test.mjs']);
});

test('promotion report CLI emits JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-cli-'));
  test.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(fixtureArtifact(), null, 2));

  const result = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts/graph-impact-promotion-report.mjs'), '--dir', dir, '--json'],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.verdict, 'not-promoted');
  assert.equal(payload.artifact_count, 1);
});

test('ci.yml archives shadow artifacts and defines graph-impact-gate job', () => {
  const ci = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
  assert.match(ci, /shadow-mode test-impact analysis/);
  assert.match(ci, /upload-artifact/);
  assert.match(ci, /shadow-history/);
  assert.match(ci, /graph-impact-gate:/);
  assert.match(ci, /graph-impact-gate\.mjs/);
});

test('docs page documents promotion threshold', () => {
  const doc = fs.readFileSync(
    path.join(REPO_ROOT, 'docs/guides/concepts/test-impact-gating.md'),
    'utf8'
  );
  assert.match(doc, /minEligibleRuns/);
  assert.match(doc, /maxOutlierRuns/);
  assert.match(doc, /not-promoted/);
});
