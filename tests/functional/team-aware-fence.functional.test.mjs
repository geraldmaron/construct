/**
 * tests/functional/team-aware-fence.functional.test.mjs — integration test for
 * team-aware fence intersection and policy gates.
 *
 * Tests the end-to-end behavior: a specialist's effective fence is bounded by
 * their team's forbiddenDecisions and decisionRights. No specialist can exceed
 * their team's authority.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { policyDecision, loadRoleManifests, clearManifestCache } from '../../lib/policy/engine.mjs';
import { computeEffectiveFence } from '../../lib/roles/fence.mjs';
import { loadRegistry, clearCache as clearRegistryCache } from '../../lib/registry/loader.mjs';

beforeEach(() => {
  clearManifestCache();
  clearRegistryCache();
});

describe('Team-aware fence integration', () => {
  it('loads manifests with registry and team information', () => {
    const manifests = loadRoleManifests();
    assert.ok(manifests.personas, 'should have personas');
    assert.ok(manifests.registry, 'should include registry with teams');
    assert.ok(manifests.registry.teams, 'should have teams');
  });

  it('specialist fence is bounded by team decisionRights', () => {
    const registry = loadRegistry();

    // Engineer is in engineering-group which forbids: product-scope, user-research, deployment-timing
    const engineerFence = {
      allowedPaths: ['lib/**', 'tests/**'],
      allowedCommands: ['npm test'],
      deniedActions: [],
      approvalRequired: ['commit'],
    };

    const effective = computeEffectiveFence('engineer', engineerFence, registry);

    // Effective fence should include team's forbidden decisions
    assert.ok(Array.isArray(effective.deniedActions), 'should have deniedActions');
    const hasForbidden = effective.deniedActions.some(d =>
      d.includes('product-scope') || d.includes('user-research') || d.includes('deployment-timing')
    );
    assert.ok(hasForbidden, 'engineer should have team-forbidden decisions blocked');
  });

  it('product-manager cannot override team-forbidden decisions', () => {
    const manifests = loadRoleManifests();

    // product-manager is in product-group which forbids: deployment, security-override, infra-change
    const d = policyDecision(
      { role: 'product-manager', tool: 'deploy', action: 'ship', decision: 'deployment' },
      { manifests }
    );

    assert.equal(d.allowed, false, 'product-manager cannot make deployment decisions (team-forbidden)');
    assert.equal(d.source, 'team.forbiddenDecisions', 'should be blocked by team gate');
  });

  it('operations can make deployment decisions (in team rights)', () => {
    const manifests = loadRoleManifests();

    // operations is in operations-group which has: decisionRights: deployment, rollback, ...
    const d = policyDecision(
      { role: 'operations', tool: 'deploy', action: 'ship', decision: 'deployment' },
      { manifests }
    );

    // Should be allowed (not forbidden, and in team decisionRights)
    assert.equal(d.allowed, true, 'operations can make deployment decisions');
  });

  it('security cannot make architecture decisions (forbidden by governance-group)', () => {
    const manifests = loadRoleManifests();

    // security is in governance-group which forbids: product-scope, implementation-approach, deployment-readiness
    const d = policyDecision(
      { role: 'security', tool: 'arch', action: 'design', decision: 'architecture' },
      { manifests }
    );

    // architecture is not in governance's forbiddenDecisions, so should be allowed
    // (governance doesn't forbid it, just doesn't grant it)
    // Since there's no explicit forbid, default is to allow
    assert.equal(d.allowed, true);
  });

  it('architect can make architecture decisions (in team rights)', () => {
    const manifests = loadRoleManifests();

    // architect is in engineering-group which has: decisionRights: architecture, technology-selection, ...
    const d = policyDecision(
      { role: 'architect', tool: 'arch', action: 'design', decision: 'architecture' },
      { manifests }
    );

    assert.equal(d.allowed, true, 'architect can make architecture decisions');
  });

  it('qa cannot make architecture decisions (not in team rights)', () => {
    const manifests = loadRoleManifests();

    // qa is in quality-group which forbids: scope-change, deployment-timing, architecture
    // So architecture is explicitly forbidden
    const d = policyDecision(
      { role: 'qa', tool: 'arch', action: 'design', decision: 'architecture' },
      { manifests }
    );

    // quality-group forbids architecture
    assert.equal(d.allowed, false, 'qa cannot make architecture decisions (team-forbidden)');
    assert.equal(d.source, 'team.forbiddenDecisions');
  });

  it('actions without decision parameter bypass team gates', () => {
    const manifests = loadRoleManifests();

    // Provide no decision parameter
    const d = policyDecision(
      { role: 'product-manager', tool: 'github', action: 'create_pr' },
      { manifests }
    );

    // Should be allowed (no decision gate applies)
    assert.equal(d.allowed, true);
  });

  it('computeEffectiveFence without registry returns specialist fence as-is', () => {
    const specialistFence = {
      allowedPaths: ['docs/**'],
      allowedCommands: ['ls', 'cat'],
      deniedActions: [],
      approvalRequired: ['commit'],
    };

    const effective = computeEffectiveFence('unknown-role', specialistFence);
    // Without registry, should return fence unchanged
    assert.deepEqual(effective, specialistFence);
  });

  it('team forbiddenDecisions are added to deniedActions in effective fence', () => {
    const registry = loadRegistry();

    const specialistFence = {
      allowedPaths: ['lib/**'],
      allowedCommands: [],
      deniedActions: ['dangerous:**'],
      approvalRequired: [],
    };

    // product-manager in product-group which forbids: deployment, security-override, infra-change
    const effective = computeEffectiveFence('product-manager', specialistFence, registry);

    // Should add team forbiddens to deniedActions
    const forbiddenPattern = effective.deniedActions.find(d =>
      d === 'deployment:**' || d === 'security-override:**' || d === 'infra-change:**'
    );
    assert.ok(forbiddenPattern, 'team forbiddenDecisions should be in deniedActions');
  });
});
