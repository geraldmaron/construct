/**
 * tests/asset-quality/quality-contract.test.mjs — Guards the manifest qualityContract surface.
 *
 * construct-cuxq.1.1 activates a registry-first quality contract: every artifact inherits a
 * default gateLevel + requiredStates from workflowDefaults, high-stakes types override to a
 * stricter level, and the manifest validator rejects an out-of-enum gateLevel. All 27 existing
 * artifacts must continue to validate with the new optional fields.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadArtifactManifest,
  validateArtifactManifest,
  resolveArtifactWorkflowContract,
  artifactTypes,
  GATE_LEVELS,
} from '../../lib/artifact-manifest.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the live manifest still validates with the qualityContract fields present', () => {
  const manifest = loadArtifactManifest({ rootDir: REPO, force: true });
  const result = validateArtifactManifest(manifest);
  assert.equal(result.valid, true, result.errors.join('; '));
});

test('every registered artifact resolves a qualityContract with a known gate level', () => {
  for (const type of artifactTypes({ rootDir: REPO })) {
    const contract = resolveArtifactWorkflowContract(type, { rootDir: REPO });
    assert.ok(contract.qualityContract, `${type} has no qualityContract`);
    assert.ok(GATE_LEVELS.includes(contract.qualityContract.gateLevel), `${type}: ${contract.qualityContract.gateLevel}`);
    assert.ok(Array.isArray(contract.qualityContract.requiredStates));
  }
});

test('an artifact with no override inherits the workflowDefaults gate level', () => {
  const contract = resolveArtifactWorkflowContract('adr', { rootDir: REPO });
  assert.equal(contract.qualityContract.gateLevel, 'standard');
  assert.deepEqual(contract.qualityContract.requiredStates, ['exported']);
});

test('a high-stakes artifact overrides to a stricter gate level with per-format states', () => {
  const contract = resolveArtifactWorkflowContract('prd', { rootDir: REPO });
  assert.equal(contract.qualityContract.gateLevel, 'render-smoke');
  assert.ok(contract.qualityContract.requiredStates.includes('renderable'));
  assert.ok(contract.qualityContract.perFormat?.pdf, 'prd should declare per-format pdf states');
});

test('invocation overrides take precedence over the inherited gate level', () => {
  const contract = resolveArtifactWorkflowContract('adr', {
    rootDir: REPO,
    overrides: { qualityContract: { gateLevel: 'full-certification' } },
  });
  assert.equal(contract.qualityContract.gateLevel, 'full-certification');
});

test('the validator rejects an out-of-enum gate level', () => {
  const result = validateArtifactManifest({
    version: 2,
    artifacts: {
      broken: {
        template: 'x.md',
        primaryOwners: ['cx-product-manager'],
        qualityContract: { gateLevel: 'turbo' },
      },
    },
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('qualityContract.gateLevel')));
});
