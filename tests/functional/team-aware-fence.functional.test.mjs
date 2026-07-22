/**
 * Policy-aware worker-profile fence integration.
 *
 * The canonical registry has no team authority layer. Worker-profile fences
 * govern actions, while Policies govern named decisions and explicit vetoes.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { clearManifestCache, loadPolicyManifests, policyDecision } from '../../lib/policy/engine.mjs';
import { clearCache as clearRegistryCache } from '../../lib/registry/loader.mjs';

beforeEach(() => {
  clearManifestCache();
  clearRegistryCache();
});

describe('Worker-profile policy fence integration', () => {
  it('loads canonical worker profiles and policies', () => {
    const manifests = loadPolicyManifests();
    assert.ok(manifests.workerProfiles);
    assert.ok(manifests.registry);
    assert.ok(manifests.registry.policies);
    assert.equal('teams' in manifests.registry, false);
    assert.equal('specialists' in manifests.registry, false);
  });

  it('applies the canonical worker-profile fence', () => {
    const manifests = loadPolicyManifests();
    const decision = policyDecision(
      { role: 'architect', tool: 'fs', action: 'edit:lib/example.mjs' },
      { manifests },
    );
    assert.equal(decision.allowed, true);
    assert.equal(decision.approvalRequired, true);
    assert.equal(decision.source, 'manifest.approvalRequired');
  });

  it('applies a governing policy veto before the profile fence', () => {
    const manifests = loadPolicyManifests();
    const decision = policyDecision(
      { role: 'security', tool: 'architecture', action: 'approve', decision: 'architecture' },
      { manifests },
    );
    assert.equal(decision.allowed, false);
    assert.equal(decision.source, 'policy.vetoWorkerProfiles');
    assert.match(decision.reason, /policy "architecture"/);
  });

  it('does not invent an execution-structure restriction when no policy governs a decision', () => {
    const manifests = loadPolicyManifests();
    const decision = policyDecision(
      { role: 'operations', tool: 'deploy', action: 'ship', decision: 'unclassified-decision' },
      { manifests },
    );
    assert.equal(decision.allowed, true);
  });
});
