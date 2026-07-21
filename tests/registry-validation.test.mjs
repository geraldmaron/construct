/**
 * tests/registry-validation.test.mjs — Canonical registry invariant tests.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadRegistry } from '../lib/registry/loader.mjs';
import { validate } from '../lib/registry/validator.mjs';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

function validRegistry() {
  return {
    schemaVersion: 1,
    workspacePresets: {
      rnd: { id: 'rnd', skills: [], procedures: [] },
    },
    workerProfiles: {
      engineer: { id: 'engineer', procedureAffinity: ['build'], capabilities: ['code.write'] },
      reviewer: { id: 'reviewer', procedureAffinity: ['build'], capabilities: [] },
    },
    procedures: {
      build: { id: 'build', workerProfiles: ['engineer', 'reviewer'] },
    },
    capabilities: {
      'code.write': {
        id: 'code.write',
        ownerWorkerProfiles: ['engineer'],
        requiredProcedures: ['build'],
        contracts: {
          review: { id: 'review', producer: 'engineer', consumer: 'reviewer' },
        },
      },
    },
    policies: {
      approval: {
        id: 'approval',
        ownerWorkerProfile: 'reviewer',
        approvalWorkerProfiles: ['reviewer'],
        vetoWorkerProfiles: [],
        escalationWorkerProfiles: [],
        requiredPolicies: [],
      },
    },
  };
}

describe('canonical registry validator', () => {
  it('accepts a coherent registry', () => {
    assert.equal(validate(validRegistry()).ok, true);
  });

  it('rejects null input', () => {
    const result = validate(null);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((entry) => entry.id === 'invalid-input'));
  });

  it('rejects invalid schema version and missing canonical maps', () => {
    const registry = validRegistry();
    registry.schemaVersion = 3;
    delete registry.workspacePresets;
    const result = validate(registry);
    assert.ok(result.errors.some((entry) => entry.id === 'invalid-schema-version'));
    assert.ok(result.errors.some((entry) => entry.id === 'missing-workspacePresets'));
  });

  for (const field of ['teams', 'groups', 'specialists', 'contracts', 'roles', 'personas', 'scopes', 'workflows']) {
    it(`rejects retired peer field ${field}`, () => {
      const registry = validRegistry();
      registry[field] = {};
      const result = validate(registry);
      assert.ok(result.errors.some((entry) => entry.id === 'retired-registry-field' && entry.location === `#/${field}`));
    });
  }

  it('rejects unknown public fields', () => {
    const registry = validRegistry();
    registry.metadata = {};
    assert.ok(validate(registry).errors.some((entry) => entry.id === 'unknown-registry-field'));
  });

  it('rejects retired or unknown fields inside canonical entities', () => {
    const registry = validRegistry();
    registry.workerProfiles.engineer.team = 'engineering';
    assert.ok(validate(registry).errors.some((entry) => entry.id === 'unknown-entity-field'));
  });

  it('rejects prefixed Worker Profile ids', () => {
    const registry = validRegistry();
    const retiredId = `${'cx'}-engineer`;
    registry.workerProfiles[retiredId] = { ...registry.workerProfiles.engineer, id: retiredId };
    assert.ok(validate(registry).errors.some((entry) => entry.id === 'prefixed-worker-profile-id'));
  });

  it('rejects mismatched map keys and ids', () => {
    const registry = validRegistry();
    registry.procedures.build.id = 'other';
    assert.ok(validate(registry).errors.some((entry) => entry.id === 'registry-id-mismatch'));
  });

  it('rejects dangling Procedure, Capability, contract-party, and Policy references', () => {
    const registry = validRegistry();
    registry.workerProfiles.engineer.procedureAffinity = ['missing'];
    registry.procedures.build.workerProfiles = ['missing'];
    registry.capabilities['code.write'].ownerWorkerProfiles = ['missing'];
    registry.capabilities['code.write'].contracts.review.consumer = 'missing';
    registry.policies.approval.requiredPolicies = ['missing'];
    const ids = new Set(validate(registry).errors.map((entry) => entry.id));
    assert.ok(ids.has('worker-profile-unknown-procedure'));
    assert.ok(ids.has('procedure-unknown-worker-profile'));
    assert.ok(ids.has('capability-unknown-worker-profile'));
    assert.ok(ids.has('capability-contract-unknown-consumer'));
    assert.ok(ids.has('policy-unknown-policy'));
  });

  it('validates the assembled checked-in registry', () => {
    const registry = loadRegistry({ rootDir: ROOT_DIR });
    const result = validate(registry);
    assert.equal(result.ok, true, result.errors.map((entry) => `${entry.id}: ${entry.message}`).join('\n'));
  });
});
