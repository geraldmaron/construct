/**
 * tests/policy-engine.test.mjs — policy decision contract.
 *
 * Pins the precedence rules (explicit deny > approvalRequired > risk
 * tier > default), the specialist manifest source mapping (fence.deniedActions,
 * fence.approvalRequired), the unknown-role denial in team / enterprise
 * mode, and the HIGH_RISK_AUTONOMOUS exception for sre / security /
 * release-manager.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { policyDecision, clearManifestCache } from '../lib/policy/engine.mjs';

function manifests(workerProfiles) {
  return { workerProfiles };
}

beforeEach(() => clearManifestCache());

describe('policyDecision', () => {
  it('denies when role / tool / action are missing', () => {
    assert.equal(policyDecision({}, { manifests: { workerProfiles: {} } }).allowed, false);
    assert.equal(policyDecision({ role: 'engineer' }, { manifests: { workerProfiles: {} } }).allowed, false);
  });

  it('denies an unknown role in team / enterprise mode by default', () => {
    const d = policyDecision(
      { role: 'imaginary', tool: 'github', action: 'create_pr' },
      { manifests: manifests({}) },
    );
    assert.equal(d.allowed, false);
    assert.match(d.reason, /no role manifest/);
  });

  it('honors fence.deniedActions as the highest-priority rule', () => {
    const d = policyDecision(
      { role: 'engineer', tool: 'github', action: 'push:main' },
      { manifests: manifests({ engineer: { fence: { deniedActions: ['push:main'] } } }) },
    );
    assert.equal(d.allowed, false);
    assert.equal(d.source, 'manifest.deniedActions');
  });

  it('honors fence.approvalRequired and marks the call allowed but approvalRequired', () => {
    const d = policyDecision(
      { role: 'engineer', tool: 'github', action: 'create_pr' },
      { manifests: manifests({ engineer: { fence: { approvalRequired: ['create_pr'] } } }) },
    );
    assert.equal(d.allowed, true);
    assert.equal(d.approvalRequired, true);
    assert.equal(d.source, 'manifest.approvalRequired');
  });

  it('flags high-risk actions as approval-required for non-autonomous roles', () => {
    const d = policyDecision(
      { role: 'engineer', tool: 'github', action: 'list', risk: 'high' },
      { manifests: manifests({ engineer: { fence: {} } }) },
    );
    assert.equal(d.allowed, true);
    assert.equal(d.approvalRequired, true);
    assert.equal(d.source, 'risk-tier');
  });

  it('lets sre / security / release-manager run high-risk actions without explicit approval', () => {
    for (const role of ['sre', 'security', 'release-manager']) {
      const d = policyDecision(
        { role, tool: 'pagerduty', action: 'acknowledge', risk: 'high' },
        { manifests: manifests({ [role]: { fence: {} } }) },
      );
      assert.equal(d.allowed, true, role);
      assert.equal(d.approvalRequired, false, role);
    }
  });

  it('falls through to default allow for low-risk actions in a known role', () => {
    const d = policyDecision(
      { role: 'engineer', tool: 'fs', action: 'read', risk: 'low' },
      { manifests: manifests({ engineer: { fence: {} } }) },
    );
    assert.equal(d.allowed, true);
    assert.equal(d.approvalRequired, false);
    assert.equal(d.source, 'default');
  });

  it('supports glob suffixes (path:**) in fence patterns', () => {
    const d = policyDecision(
      { role: 'engineer', tool: 'fs', action: 'edit:lib/foo.mjs' },
      { manifests: manifests({ engineer: { fence: { approvalRequired: ['edit:lib/**'] } } }) },
    );
    assert.equal(d.approvalRequired, true);
  });
});

describe('policyDecision against the canonical worker-profile registry', () => {
  it('reads the shipped worker-profile manifests when no manifestPath override is supplied', () => {
    const d = policyDecision({ role: 'sre', tool: 'github', action: 'create_pr' });
    assert.equal(typeof d.allowed, 'boolean');
    assert.ok(d.reason);
  });
});

describe('policyDecision with policy decision gates', () => {
  it('blocks a decision vetoed by a governing policy', () => {
    const mockRegistry = {
      policies: {
        governance: {
          id: 'governance',
          governs: ['security-override'],
          vetoWorkerProfiles: ['security'],
        },
      },
    };
    const manifestsWithRegistry = {
      workerProfiles: {
        security: { fence: {} },
      },
      registry: mockRegistry,
    };
    const d = policyDecision(
      { role: 'security', tool: 'github', action: 'override', decision: 'security-override' },
      { manifests: manifestsWithRegistry }
    );
    assert.equal(d.allowed, false);
    assert.equal(d.source, 'policy.vetoWorkerProfiles');
    assert.match(d.reason, /vetoed/);
  });

  it('allows a decision when the governing policy does not veto the profile', () => {
    const mockRegistry = {
      policies: {
        governance: {
          id: 'governance',
          governs: ['security-approval'],
          vetoWorkerProfiles: ['reviewer'],
        },
      },
    };
    const manifestsWithRegistry = {
      workerProfiles: {
        security: { fence: {} },
      },
      registry: mockRegistry,
    };
    const d = policyDecision(
      { role: 'security', tool: 'github', action: 'approve', decision: 'security-approval' },
      { manifests: manifestsWithRegistry }
    );
    assert.equal(d.allowed, true);
  });

  it('allows a decision when no policy governs it', () => {
    const mockRegistry = {
      policies: {},
    };
    const manifestsWithRegistry = {
      workerProfiles: {
        security: { fence: {} },
      },
      registry: mockRegistry,
    };
    const d = policyDecision(
      { role: 'security', tool: 'github', action: 'anything', decision: 'random-decision' },
      { manifests: manifestsWithRegistry }
    );
    assert.equal(d.allowed, true);
  });

  it('allows actions when no decision parameter is supplied', () => {
    const manifestsWithRegistry = {
      workerProfiles: {
        engineer: { fence: {} },
      },
      registry: {
        policies: {},
      },
    };
    const d = policyDecision(
      { role: 'engineer', tool: 'github', action: 'create_pr' },
      { manifests: manifestsWithRegistry }
    );
    assert.equal(d.allowed, true);
  });
});
