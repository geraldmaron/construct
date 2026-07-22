/**
 * tests/registry-loader.test.mjs — Canonical registry loader contract.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  clearCache,
  getCapability,
  getPolicy,
  getProcedure,
  getWorkerProfile,
  getWorkspacePreset,
  listCapabilities,
  listProcedures,
  listWorkerProfiles,
  listWorkspacePresets,
  loadRegistry,
} from '../lib/registry/loader.mjs';
import * as registryLoader from '../lib/registry/loader.mjs';

const RETIRED_FIELDS = ['teams', 'groups', 'specialists', 'contracts', 'roles', 'personas', 'scopes', 'workflows'];

describe('canonical registry loader', () => {
  beforeEach(clearCache);
  afterEach(clearCache);

  it('loads only canonical peer fields', () => {
    const registry = loadRegistry();
    assert.deepEqual(Object.keys(registry), [
      'schemaVersion',
      'workspacePresets',
      'workerProfiles',
      'procedures',
      'capabilities',
      'policies',
    ]);
    for (const field of RETIRED_FIELDS) assert.equal(field in registry, false, field);
  });

  it('does not export retired loader aliases', () => {
    for (const name of ['getTeam', 'getSpecialist', 'getContract', 'listTeams', 'listSpecialists', 'listGroupsHierarchical']) {
      assert.equal(name in registryLoader, false, name);
    }
  });

  it('distinguishes Workspace Presets from assignable Worker Profiles', () => {
    const preset = getWorkspacePreset('rnd');
    const profile = getWorkerProfile('engineer');
    assert.ok(preset);
    assert.ok(profile);
    assert.ok(preset.intake);
    assert.ok(Array.isArray(preset.artifactClasses));
    assert.equal('runtime' in preset, false);
    assert.equal(profile.runtime, 'host-agent');
    assert.equal(profile.modelTier, 'standard');
    assert.ok(Array.isArray(profile.skillEmphasis));
    assert.equal(getWorkerProfile(`${'cx'}-engineer`), null);
  });

  it('nests handoff contracts below Capabilities', () => {
    const capability = getCapability('orchestration.routing');
    assert.ok(capability);
    assert.ok(capability.contracts['user-to-construct']);
    assert.equal(capability.contracts['user-to-construct'].producer, 'user');
    assert.equal(capability.contracts['user-to-construct'].consumer, 'construct');
  });

  it('loads Procedures and canonicalizes worker references', () => {
    const procedure = getProcedure('architecture-review');
    assert.ok(procedure);
    assert.deepEqual(procedure.workerProfiles, ['architect', 'security', 'reviewer']);
    assert.equal(procedure.modelTier, 'strong');
  });

  it('loads Policies without execution-structure references', () => {
    const policy = getPolicy('intake-triage');
    assert.ok(policy);
    assert.equal(policy.ownerWorkerProfile, 'product-manager');
    assert.equal('owner' in policy, false);
    assert.equal('requiresApprovalFrom' in policy, false);
  });

  it('lists each canonical catalog', () => {
    assert.ok(listWorkspacePresets().length > 0);
    assert.ok(listWorkerProfiles().length > 0);
    assert.ok(listProcedures().length > 0);
    assert.ok(listCapabilities().length > 0);
  });

  it('caches by root and catalog mtime', () => {
    const first = loadRegistry();
    const second = loadRegistry();
    assert.equal(first, second);
    clearCache();
    assert.notEqual(loadRegistry(), first);
  });
});
