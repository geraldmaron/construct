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

function manifests(personas) {
  return { personas };
}

beforeEach(() => clearManifestCache());

describe('policyDecision', () => {
  it('denies when role / tool / action are missing', () => {
    assert.equal(policyDecision({}, { manifests: { personas: {} } }).allowed, false);
    assert.equal(policyDecision({ role: 'engineer' }, { manifests: { personas: {} } }).allowed, false);
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

describe('policyDecision against the unified registry specialists', () => {
  it('reads the shipped specialist manifests when no manifestPath override is supplied', () => {
    const d = policyDecision({ role: 'sre', tool: 'github', action: 'create_pr' });
    assert.equal(typeof d.allowed, 'boolean');
    assert.ok(d.reason);
  });
});

describe('policyDecision with team-aware decision gates', () => {
  it('blocks a decision forbidden by the role\'s team', () => {
    // product-manager is in product-group which forbids product-scope (counter-intuitive but tests forbidding)
    // security-override is forbidden by governance-group
    const mockRegistry = {
      teams: {
        'governance-group': {
          id: 'governance-group',
          roles: ['security'],
          forbiddenDecisions: ['security-override'],
          decisionRights: ['security-approval'],
        },
      },
    };
    const manifestsWithRegistry = {
      personas: {
        security: { fence: {} },
      },
      registry: mockRegistry,
    };
    const d = policyDecision(
      { role: 'security', tool: 'github', action: 'override', decision: 'security-override' },
      { manifests: manifestsWithRegistry }
    );
    assert.equal(d.allowed, false);
    assert.equal(d.source, 'team.forbiddenDecisions');
    assert.match(d.reason, /forbidden/);
  });

  it('allows a decision authorized by the role\'s team', () => {
    const mockRegistry = {
      teams: {
        'governance-group': {
          id: 'governance-group',
          roles: ['security'],
          forbiddenDecisions: [],
          decisionRights: ['security-approval'],
        },
      },
    };
    const manifestsWithRegistry = {
      personas: {
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

  it('allows a decision when no team restriction is set', () => {
    const mockRegistry = {
      teams: {
        'governance-group': {
          id: 'governance-group',
          roles: ['security'],
          forbiddenDecisions: [],
          decisionRights: [],
        },
      },
    };
    const manifestsWithRegistry = {
      personas: {
        security: { fence: {} },
      },
      registry: mockRegistry,
    };
    const d = policyDecision(
      { role: 'security', tool: 'github', action: 'anything', decision: 'random-decision' },
      { manifests: manifestsWithRegistry }
    );
    // No explicit forbid, so should be allowed
    assert.equal(d.allowed, true);
  });

  it('allows actions when no decision parameter is supplied', () => {
    const manifestsWithRegistry = {
      personas: {
        engineer: { fence: {} },
      },
      registry: {
        teams: {
          'engineering-group': {
            id: 'engineering-group',
            roles: ['engineer'],
            forbiddenDecisions: ['product-scope'],
            decisionRights: ['architecture'],
          },
        },
      },
    };
    const d = policyDecision(
      { role: 'engineer', tool: 'github', action: 'create_pr' },
      { manifests: manifestsWithRegistry }
    );
    // Without decision param, team gates don't apply
    assert.equal(d.allowed, true);
  });
});
