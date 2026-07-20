/**
 * tests/doctor/provider-certification-drift.test.mjs — provider certification
 * drift via lib/doctor/watchers/consistency.mjs (construct-4uxq0.13.5).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findProviderCertificationDrift } from '../../lib/certification/provider-evidence-tiers.mjs';
import { runAllChecks } from '../../lib/doctor/watchers/consistency.mjs';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const FIXTURE_MANIFESTS = [{ id: 'fixture-provider', filePath: 'lib/extensions/manifests/fixture-provider.manifest.json' }];
const EMPTY_CORPUS = [];

test('findProviderCertificationDrift reports no drift when certification.tier matches computed tier', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-provider-drift-clean-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const manifestsDir = path.join(tmpDir, 'lib', 'extensions', 'manifests');
  fs.mkdirSync(manifestsDir, { recursive: true });
  fs.writeFileSync(path.join(manifestsDir, 'fixture-provider.manifest.json'), JSON.stringify({
    id: 'fixture-provider',
    version: '1.0.0',
    kind: 'data-source',
    capabilities: ['read'],
    certification: { tier: 'structurally-validated' },
  }, null, 2));

  const drifts = findProviderCertificationDrift({
    rootDir: tmpDir,
    manifests: FIXTURE_MANIFESTS,
    corpusFiles: EMPTY_CORPUS,
  });
  assert.equal(drifts.length, 0);
});

test('findProviderCertificationDrift flags an inflated certification.tier claim', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-provider-drift-stale-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const manifestsDir = path.join(tmpDir, 'lib', 'extensions', 'manifests');
  fs.mkdirSync(manifestsDir, { recursive: true });
  fs.writeFileSync(path.join(manifestsDir, 'fixture-provider.manifest.json'), JSON.stringify({
    id: 'fixture-provider',
    version: '1.0.0',
    kind: 'data-source',
    capabilities: ['read'],
    certification: { tier: 'production-proven' },
  }, null, 2));

  const drifts = findProviderCertificationDrift({
    rootDir: tmpDir,
    manifests: FIXTURE_MANIFESTS,
    corpusFiles: EMPTY_CORPUS,
  });
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].claimedTier, 'production-proven');
  assert.equal(drifts[0].computedTier, 'structurally-validated');
});

test('runAllChecks reports zero provider-certification-drift on the live repo', async () => {
  const result = await runAllChecks({ repoRoot: REPO_ROOT });
  const driftFindings = result.findings.filter((f) => f.category === 'provider-certification-drift');
  assert.equal(
    driftFindings.length,
    0,
    `expected no provider-certification drift on a clean tree, got:\n${driftFindings.map((f) => '  - ' + f.summary).join('\n')}`,
  );
  const driftPass = result.passed?.find((p) => p.category === 'provider-certification-drift');
  assert.ok(driftPass, 'provider certification drift check must run each tick');
  assert.match(driftPass.summary, /^provider-certification-drift: 0 drift\(s\)/);
});
