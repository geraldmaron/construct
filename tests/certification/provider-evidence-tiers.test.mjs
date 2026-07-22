/**
 * tests/certification/provider-evidence-tiers.test.mjs — provider evidence-tier ladder.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  PROVIDER_EVIDENCE_TIERS,
  computeProviderEvidenceTier,
  auditProviderManifest,
  auditKnownProviderManifests,
  findProviderCertificationDrift,
  crossCheckProviderCardFallback,
  detectProviderFallbackTestEvidence,
  auditProviderCardFallbackClaims,
  PROVIDER_FALLBACK_TEST_FINGERPRINTS,
  resolveProductionGateTier,
  meetsProductionGate,
  DEFAULT_PRODUCTION_GATE_TIER,
} from '../../lib/certification/provider-evidence-tiers.mjs';

test('PROVIDER_EVIDENCE_TIERS is the fixed six-rung ladder', () => {
  assert.deepEqual(PROVIDER_EVIDENCE_TIERS, [
    'declared',
    'structurally-validated',
    'contract-tested',
    'process-boundary-tested',
    'live-sandbox-tested',
    'production-proven',
  ]);
});

test('a provider with no manifest at all has no tier', () => {
  const result = computeProviderEvidenceTier({ id: 'ghost' }, { declared: false });
  assert.equal(result.tier, null);
});

test('a declared provider whose manifest fails schema validation caps at declared', () => {
  const result = computeProviderEvidenceTier({ id: 'broken' }, {
    declared: true,
    structurallyValid: false,
    structuralReason: 'missing required field: kind',
  });
  assert.equal(result.tier, 'declared');
  assert.match(result.reason, /missing required field/);
});

test('a schema-valid manifest with zero test-corpus coverage caps at structurally-validated', () => {
  const result = computeProviderEvidenceTier({ id: 'untested' }, {
    declared: true,
    structurallyValid: true,
    contractTested: { pass: false, testFiles: [] },
  });
  assert.equal(result.tier, 'structurally-validated');
  assert.equal(result.evidence, null);
});

test('contract-tested evidence without a process-boundary test caps at contract-tested', () => {
  const result = computeProviderEvidenceTier({ id: 'faked' }, {
    declared: true,
    structurallyValid: true,
    contractTested: { pass: true, testFiles: ['tests/fake.test.mjs'] },
    processBoundaryTested: { pass: false, testFiles: [] },
  });
  assert.equal(result.tier, 'contract-tested');
  assert.deepEqual(result.evidence.contractTestFiles, ['tests/fake.test.mjs']);
});

test('a process-boundary test lifts the tier past contract-tested', () => {
  const result = computeProviderEvidenceTier({ id: 'boundary' }, {
    declared: true,
    structurallyValid: true,
    contractTested: { pass: true, testFiles: [] },
    processBoundaryTested: { pass: true, testFiles: ['tests/functional/x.functional.test.mjs'] },
  });
  assert.equal(result.tier, 'process-boundary-tested');
});

test('honest ceiling: a human-set live-sandbox-tested attestation with no contract or process-boundary evidence still caps at structurally-validated', () => {
  const result = computeProviderEvidenceTier({ id: 'overclaiming' }, {
    declared: true,
    structurallyValid: true,
    contractTested: { pass: false, testFiles: [] },
    processBoundaryTested: { pass: false, testFiles: [] },
    liveSandboxAttested: { attested: true, attestedAt: '2026-01-01', attestedBy: 'someone@example.com' },
    productionProvenAttested: { attested: true, attestedAt: '2026-01-01', attestedBy: 'someone@example.com' },
  });
  assert.equal(result.tier, 'structurally-validated', 'attestation must never be read before the rungs below it hold');
});

test('a live-sandbox attestation only lifts the tier once contract and process-boundary evidence both hold', () => {
  const result = computeProviderEvidenceTier({ id: 'earned' }, {
    declared: true,
    structurallyValid: true,
    contractTested: { pass: true, testFiles: ['tests/a.test.mjs'] },
    processBoundaryTested: { pass: true, testFiles: ['tests/functional/a.functional.test.mjs'] },
    liveSandboxAttested: { attested: true, attestedAt: '2026-01-01', attestedBy: 'someone@example.com' },
    productionProvenAttested: { attested: false },
  });
  assert.equal(result.tier, 'live-sandbox-tested');
});

test('production-proven requires its own separate attestation, not inherited from live-sandbox-tested', () => {
  const result = computeProviderEvidenceTier({ id: 'earned-not-prod' }, {
    declared: true,
    structurallyValid: true,
    contractTested: { pass: true, testFiles: ['tests/a.test.mjs'] },
    processBoundaryTested: { pass: true, testFiles: ['tests/functional/a.functional.test.mjs'] },
    liveSandboxAttested: { attested: true, attestedAt: '2026-01-01', attestedBy: 'someone@example.com' },
    productionProvenAttested: { attested: false, attestedAt: null, attestedBy: null },
  });
  assert.equal(result.tier, 'live-sandbox-tested');
});

test('both attestations present reaches production-proven', () => {
  const result = computeProviderEvidenceTier({ id: 'fully-proven' }, {
    declared: true,
    structurallyValid: true,
    contractTested: { pass: true, testFiles: ['tests/a.test.mjs'] },
    processBoundaryTested: { pass: true, testFiles: ['tests/functional/a.functional.test.mjs'] },
    liveSandboxAttested: { attested: true, attestedAt: '2026-01-01', attestedBy: 'a@example.com' },
    productionProvenAttested: { attested: true, attestedAt: '2026-02-01', attestedBy: 'b@example.com' },
  });
  assert.equal(result.tier, 'production-proven');
});

test('findProviderCertificationDrift is active on the live tree: stamped certification.tier matches computed tier', () => {
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const expectedTiers = {
    github: 'process-boundary-tested',
    linear: 'contract-tested',
    'atlassian-jira': 'contract-tested',
    slack: 'contract-tested',
    'atlassian-confluence': 'structurally-validated',
    'jira-write': 'contract-tested',
    'confluence-write': 'contract-tested',
  };

  const audits = auditKnownProviderManifests({ rootDir });
  const present = audits.filter((r) => !r.manifestErrors.some((e) => /file does not exist/.test(e)));
  assert.ok(present.length >= 7, `expected at least seven present manifests, got ${present.length}`);

  let stampedCount = 0;
  for (const audit of present) {
    const expected = expectedTiers[audit.provider.id];
    if (!expected) continue;
    const absPath = path.join(rootDir, audit.provider.filePath);
    const manifest = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    assert.equal(
      manifest.certification?.tier,
      expected,
      `${audit.provider.id} must stamp certification.tier ${expected}`,
    );
    assert.equal(audit.tier, expected, `${audit.provider.id} computed tier must match stamped tier`);
    stampedCount += 1;
  }
  assert.equal(stampedCount, Object.keys(expectedTiers).length, 'every known present provider must stamp certification.tier');

  const drifts = findProviderCertificationDrift({ rootDir });
  assert.equal(drifts.length, 0, `expected zero drift once tiers are stamped, got: ${drifts.map((d) => d.providerId).join(', ')}`);
});

test('resolveProductionGateTier defaults to contract-tested and validates overrides', () => {
  assert.equal(resolveProductionGateTier(), DEFAULT_PRODUCTION_GATE_TIER);
  assert.equal(resolveProductionGateTier({ override: 'process-boundary-tested' }), 'process-boundary-tested');
  assert.throws(() => resolveProductionGateTier({ override: 'not-a-real-tier' }), /invalid production gate tier/);
});

test('meetsProductionGate compares ladder position, not string equality', () => {
  assert.equal(meetsProductionGate('process-boundary-tested', 'contract-tested'), true);
  assert.equal(meetsProductionGate('structurally-validated', 'contract-tested'), false);
  assert.equal(meetsProductionGate(null, 'declared'), false);
});

// A fixture manifest set proving the audit correctly identifies an
// over-claiming manifest: a hand-authored certification block claims
// live-sandbox-tested with no corroborating attestation object at all
// (malformed input, the shape a hostile or careless manifest author might
// produce), and a manifest with no certification block at all. Both must be
// computed fresh from real evidence, never read off the manifest's own claim.

test('auditProviderManifest recomputes the tier from real evidence, ignoring a manifest\'s own inflated claim', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-provider-audit-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const testsDir = path.join(tmpDir, 'tests');
  fs.mkdirSync(testsDir, { recursive: true });

  const manifestsDir = path.join(tmpDir, 'lib', 'extensions', 'manifests');
  fs.mkdirSync(manifestsDir, { recursive: true });
  const manifestPath = path.join(manifestsDir, 'fixture-provider.manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    id: 'fixture-provider',
    version: '1.0.0',
    kind: 'data-source',
    capabilities: ['read'],
    // An over-claiming manifest: it asserts a top-tier certification block
    // (no genuine contract/process-boundary evidence anywhere in the fixture
    // corpus below) — the audit must not take this claim at face value.
    certification: { tier: 'production-proven', claimedWithoutEvidence: true },
  }, null, 2));

  const result = auditProviderManifest(
    { id: 'fixture-provider', filePath: path.relative(tmpDir, manifestPath) },
    { rootDir: tmpDir },
  );

  assert.equal(result.tier, 'structurally-validated', 'the manifest\'s own inflated claim must not be trusted');
  assert.equal(result.manifestErrors.length, 0);
});

test('auditProviderManifest reports a missing manifest file honestly, with no tier', () => {
  const result = auditProviderManifest(
    { id: 'does-not-exist', filePath: 'lib/extensions/manifests/does-not-exist.manifest.json' },
    { rootDir: os.tmpdir() },
  );
  assert.equal(result.tier, null);
  assert.ok(result.manifestErrors.length > 0);
});

test('auditProviderManifest reports a schema-invalid manifest at declared, not structurally-validated', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-provider-audit-invalid-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const manifestPath = path.join(tmpDir, 'invalid.manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ id: 'invalid-provider', version: 'not-a-semver' }));

  const result = auditProviderManifest({ id: 'invalid-provider', filePath: 'invalid.manifest.json' }, { rootDir: tmpDir });
  assert.equal(result.tier, 'declared');
  assert.ok(result.manifestErrors.some((e) => /version must be a semver/.test(e)));
});

// The real, checked-in manifest set — proves the audit runs end to end
// against actual files and actual test-corpus evidence, not a mock.

test('auditKnownProviderManifests computes a real tier for every present known provider manifest', () => {
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const results = auditKnownProviderManifests({ rootDir });
  const present = results.filter((r) => !r.manifestErrors.some((e) => /file does not exist/.test(e)));
  assert.ok(present.length >= 7, `expected at least seven present manifests, got ${present.length}`);

  const byId = Object.fromEntries(present.map((r) => [r.provider.id, r]));
  for (const id of Object.keys(byId)) {
    assert.ok(PROVIDER_EVIDENCE_TIERS.includes(byId[id].tier), `${id} must resolve to a real ladder tier, got ${byId[id].tier}`);
    assert.equal(byId[id].manifestErrors.length, 0, `${id} manifest must be schema-valid`);
  }

  for (const id of Object.keys(byId)) {
    assert.ok(
      !['live-sandbox-tested', 'production-proven'].includes(byId[id].tier),
      `${id} should not reach an attestation-only tier without a recorded attestation`,
    );
  }
});

test('crossCheckProviderCardFallback reports a gap when degraded-chain has no fallback test evidence', () => {
  const gaps = crossCheckProviderCardFallback({
    providerId: 'fixture-unproven-fallback',
    card: {
      id: 'fixture-unproven-fallback',
      fallback: { behavior: 'degraded-chain', chain: [{ id: 'primary', mode: 'sidecar' }] },
    },
    corpusFiles: [{ path: 'tests/unrelated.test.mjs', category: 'unit' }],
    rootDir: '/tmp',
  });
  assert.equal(gaps.length, 1);
  assert.match(gaps[0].message, /no test in the corpus exercises the declared fallback path/);
});

test('crossCheckProviderCardFallback passes when fallback fingerprint tests exist', () => {
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const gaps = crossCheckProviderCardFallback({
    providerId: 'docling',
    card: { id: 'docling', fallback: { behavior: 'degraded-chain' } },
    rootDir,
  });
  assert.equal(gaps.length, 0, gaps.map((g) => g.message).join('; '));
});

test('crossCheckProviderCardFallback ignores graceful-skip optional deps without flooding gaps', () => {
  const gaps = crossCheckProviderCardFallback({
    providerId: 'ink',
    card: { id: 'ink', fallback: { behavior: 'graceful-skip' } },
    corpusFiles: [],
    rootDir: '/tmp',
  });
  assert.equal(gaps.length, 0);
});

test('auditProviderCardFallbackClaims surfaces whisper degraded-chain gap on live registry', () => {
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const gaps = auditProviderCardFallbackClaims({ rootDir });
  const whisperGap = gaps.find((g) => g.providerId === 'whisper');
  assert.ok(whisperGap, 'whisper degraded-chain should report missing fallback test evidence');
  const doclingGap = gaps.find((g) => g.providerId === 'docling');
  assert.equal(doclingGap, undefined, 'docling fallback is covered by ingest-docling-fallback tests');
});

test('providers without Provider Cards keep existing tier audit behavior', () => {
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const audit = auditKnownProviderManifests({ rootDir }).find((r) => r.provider.id === 'github');
  assert.ok(audit);
  assert.equal(audit.cardFallbackGaps?.length ?? 0, 0);
  assert.equal(audit.providerCardId, null);
});

