/**
 * tests/policy-deny-default.test.mjs
 *
 * Tests for the deny-by-default policy mode introduced for team/enterprise
 * deployments (construct-9oi4.8.3 / LMCP-H3).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultDecision, policyDecision, clearManifestCache } from '../lib/policy/engine.mjs';

// ---------------------------------------------------------------------------
// getDefaultDecision unit tests
// ---------------------------------------------------------------------------

describe('getDefaultDecision', () => {
  it('solo → allow', () => {
    assert.equal(getDefaultDecision('solo'), 'allow');
  });

  it('team → deny-unclassified', () => {
    assert.equal(getDefaultDecision('team'), 'deny-unclassified');
  });

  it('enterprise → deny', () => {
    assert.equal(getDefaultDecision('enterprise'), 'deny');
  });

  it('undefined/unknown → allow (permissive fallback)', () => {
    assert.equal(getDefaultDecision(undefined), 'allow');
    assert.equal(getDefaultDecision('unknown-mode'), 'allow');
  });
});

// ---------------------------------------------------------------------------
// Minimal in-memory manifests — no file I/O, no registry
// ---------------------------------------------------------------------------

/** Build a manifests object with one role whose fence is empty (no rules). */
function minimalManifests(roleId = 'engineer') {
  return {
    personas: {
      [roleId]: {
        events: [],
        fence: {},
        outputs: { docTypes: [] },
        teamId: null,
      },
    },
    registry: null,
  };
}

/** Build manifests with an explicit allow rule for a given action pattern. */
function manifestsWithApprovalRequired(roleId, actionPattern) {
  return {
    personas: {
      [roleId]: {
        events: [],
        fence: { approvalRequired: [actionPattern] },
        outputs: { docTypes: [] },
        teamId: null,
      },
    },
    registry: null,
  };
}

// ---------------------------------------------------------------------------
// policyDecision deny-by-default integration tests
// ---------------------------------------------------------------------------

describe('policyDecision — deny-by-default', () => {
  const baseInput = {
    role: 'engineer',
    tool: 'bash',
    action: 'bash:run',
  };

  it('solo mode with no rules → allow', () => {
    clearManifestCache();
    const result = policyDecision(
      { ...baseInput, deploymentMode: 'solo' },
      { manifests: minimalManifests('engineer') },
    );
    assert.equal(result.allowed, true, `expected allow, got: ${result.reason}`);
    assert.equal(result.source, 'default');
  });

  it('team mode with no rules → deny with reason deny-by-default', () => {
    clearManifestCache();
    const result = policyDecision(
      { ...baseInput, deploymentMode: 'team' },
      { manifests: minimalManifests('engineer') },
    );
    assert.equal(result.allowed, false, 'expected deny');
    assert.equal(result.reason, 'deny-by-default');
    assert.equal(result.mode, 'team');
  });

  it('enterprise mode with no rules → deny', () => {
    clearManifestCache();
    const result = policyDecision(
      { ...baseInput, deploymentMode: 'enterprise' },
      { manifests: minimalManifests('engineer') },
    );
    assert.equal(result.allowed, false, 'expected deny');
    assert.equal(result.reason, 'deny-by-default');
    assert.equal(result.mode, 'enterprise');
  });

  it('explicit approvalRequired rule in team mode → allowed (grant wins, with approval)', () => {
    clearManifestCache();
    const result = policyDecision(
      { ...baseInput, deploymentMode: 'team' },
      { manifests: manifestsWithApprovalRequired('engineer', 'bash:run') },
    );
    assert.equal(result.allowed, true, `expected allow from explicit grant, got: ${result.reason}`);
    assert.equal(result.approvalRequired, true);
    assert.equal(result.source, 'manifest.approvalRequired');
  });

  it('explicit deny rule in team mode → deny (explicit deny, not deny-by-default)', () => {
    clearManifestCache();
    const manifests = {
      personas: {
        engineer: {
          events: [],
          fence: { deniedActions: ['bash:run'] },
          outputs: { docTypes: [] },
          teamId: null,
        },
      },
      registry: null,
    };
    const result = policyDecision(
      { ...baseInput, deploymentMode: 'team' },
      { manifests },
    );
    assert.equal(result.allowed, false);
    assert.equal(result.source, 'manifest.deniedActions');
  });

  it('deploymentMode defaults to solo when omitted', () => {
    clearManifestCache();
    const result = policyDecision(
      { role: 'engineer', tool: 'bash', action: 'bash:run' },
      { manifests: minimalManifests('engineer') },
    );
    assert.equal(result.allowed, true, 'omitting deploymentMode should default to solo (allow)');
  });
});
