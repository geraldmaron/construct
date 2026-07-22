/**
 * tests/scripts/supply-chain-release-gate.test.mjs — conjunctive composed gate
 * for construct-tsyfe.10.7.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runSupplyChainReleaseGate,
  checkOsvLicenseDependencyReview,
  checkSbomReleaseWiring,
  checkProviderCardProvenance,
  checkPackedArtifactCertification,
  checkCompiledBinaryCertification,
  checkCompatSurfaceExpiration,
  SUPPLY_CHAIN_SUBCHECKS,
} from '../../scripts/supply-chain-release-gate.mjs';

test('SUPPLY_CHAIN_SUBCHECKS lists all six composed ids', () => {
  assert.equal(SUPPLY_CHAIN_SUBCHECKS.length, 6);
});

test('gate passes when all six sub-checks pass on the real repo', () => {
  const report = runSupplyChainReleaseGate({ json: true });
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(report.results.length, 6);
});

test('gate is conjunctive: one injected failing sub-check fails the whole gate', () => {
  const failing = () => ({
    id: 'injected-failure',
    ok: false,
    errors: ['deliberate fixture failure'],
    evidence: {},
  });
  const report = runSupplyChainReleaseGate({
    checks: [
      checkOsvLicenseDependencyReview,
      checkSbomReleaseWiring,
      checkProviderCardProvenance,
      checkPackedArtifactCertification,
      checkCompiledBinaryCertification,
      failing,
    ],
  });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.includes('injected-failure')));
});

test('compiled-binary sub-check enforces asymmetric certification posture', () => {
  const result = checkCompiledBinaryCertification();
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.evidence.parityImplied, false);
});

test('compat-surface sub-check runs validate-compat-surfaces against the real registry', () => {
  const result = checkCompatSurfaceExpiration();
  assert.equal(result.ok, true, result.errors.join('\n'));
});
