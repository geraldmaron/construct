/**
 * tests/policy/role-authority.test.mjs — identity-anchored role claim authority.
 *
 * Pins LMCP-I6: policy decisions take identity (H2) + role claims. In
 * team/enterprise an env-claimed role must be present in the identity's
 * registered grants or the claim is denied; solo keeps the env-ergonomic
 * CONSTRUCT_ROLE convenience unchanged.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { authorizeRoleClaim, resolveIdentityGrants } from '../../lib/policy/role-authority.mjs';
import { policyDecision, clearManifestCache } from '../../lib/policy/engine.mjs';
import { serviceIdentity, humanIdentity } from '../../lib/identity.mjs';

beforeEach(() => clearManifestCache());

function manifests(personas) {
  return { personas };
}

describe('resolveIdentityGrants', () => {
  it('returns an empty set when identity has no grants field', () => {
    const grants = resolveIdentityGrants(serviceIdentity({ serviceId: 'svc-1' }));
    assert.equal(grants.size, 0);
  });

  it('returns an empty set for malformed grants (non-array)', () => {
    const grants = resolveIdentityGrants({ grants: 'engineer' });
    assert.equal(grants.size, 0);
  });

  it('filters non-string entries out of a grants array', () => {
    const grants = resolveIdentityGrants({ grants: ['engineer', 42, null, 'security'] });
    assert.deepEqual([...grants].sort(), ['engineer', 'security']);
  });
});

describe('authorizeRoleClaim', () => {
  it('solo mode always authorizes the claim (env ergonomics preserved)', () => {
    const result = authorizeRoleClaim({ identity: null, role: 'security', deploymentMode: 'solo' });
    assert.equal(result.authorized, true);
    assert.equal(result.source, 'solo-ergonomics');
  });

  it('solo mode authorizes even with no identity at all', () => {
    const result = authorizeRoleClaim({ role: 'release-manager' });
    assert.equal(result.authorized, true);
  });

  it('team mode denies a role claim with no identity', () => {
    const result = authorizeRoleClaim({ identity: null, role: 'security', deploymentMode: 'team' });
    assert.equal(result.authorized, false);
    assert.match(result.reason, /no identity resolved/);
  });

  it('team mode denies an env-claimed role not in the identity\'s grants', () => {
    const identity = { ...serviceIdentity({ serviceId: 'role:security', role: 'security', source: 'env-fallback' }), grants: ['engineer'] };
    const result = authorizeRoleClaim({ identity, role: 'security', deploymentMode: 'team' });
    assert.equal(result.authorized, false);
    assert.equal(result.source, 'role-authority.ungranted');
    assert.match(result.reason, /not in this identity's registered grants/);
  });

  it('team mode authorizes a role claim present in the identity\'s grants', () => {
    // humanIdentity()/serviceIdentity() (H2) accept no `grants` field; the
    // registration resolver (future G5, or a test fixture) attaches grants
    // separately, same pattern a real caller would use.
    const identity = { ...humanIdentity({ userId: 'alice@co.com', role: 'security', source: 'headers' }), grants: ['security', 'engineer'] };
    const result = authorizeRoleClaim({ identity, role: 'security', deploymentMode: 'team' });
    assert.equal(result.authorized, true);
    assert.equal(result.source, 'identity-grant');
  });

  it('enterprise mode denies an ungranted role claim same as team', () => {
    const identity = { ...serviceIdentity({ serviceId: 'worker-1', role: 'release-manager', source: 'headers' }), grants: ['engineer'] };
    const result = authorizeRoleClaim({ identity, role: 'release-manager', deploymentMode: 'enterprise' });
    assert.equal(result.authorized, false);
  });

  it('missing role claim is denied regardless of mode', () => {
    const result = authorizeRoleClaim({ identity: humanIdentity({ userId: 'x@y.com' }), role: '', deploymentMode: 'team' });
    assert.equal(result.authorized, false);
    assert.match(result.reason, /role claim is required/);
  });
});

// ---------------------------------------------------------------------------
// End-to-end through policyDecision — the path the MCP broker calls.
// ---------------------------------------------------------------------------

describe('policyDecision — identity-anchored role authority (team mode)', () => {
  it('denies an env-claimed role not in the identity\'s grants (acceptance criterion)', () => {
    const identity = { ...serviceIdentity({ serviceId: 'role:security', role: 'security', source: 'env-fallback' }), grants: ['engineer'] };
    const d = policyDecision(
      { role: 'security', tool: 'bash', action: 'bash:run', deploymentMode: 'team', identity },
      { manifests: manifests({ security: { fence: {} } }) },
    );
    assert.equal(d.allowed, false, `expected deny, got: ${d.reason}`);
    assert.equal(d.source, 'role-authority.ungranted');
  });

  it('allows a role claim present in the identity\'s grants, falling through to manifest rules', () => {
    const identity = { ...humanIdentity({ userId: 'alice@co.com', role: 'engineer', source: 'headers' }), grants: ['engineer'] };
    const d = policyDecision(
      { role: 'engineer', tool: 'bash', action: 'bash:run', deploymentMode: 'team', identity },
      { manifests: manifests({ engineer: { fence: {} } }) },
    );
    assert.equal(d.allowed, false, 'still deny-by-default with no explicit manifest grant');
    assert.equal(d.source, 'deny-by-default');
  });

  it('denies before consulting the manifest at all — ungranted claim short-circuits', () => {
    // Even a role with an explicit allow-everything manifest is denied when the
    // identity has no matching grant — the authority gate runs first.
    const identity = { ...serviceIdentity({ serviceId: 'role:security', role: 'security', source: 'env-fallback' }), grants: [] };
    const d = policyDecision(
      { role: 'security', tool: 'pagerduty', action: 'acknowledge', risk: 'high', deploymentMode: 'team', identity },
      { manifests: manifests({ security: { fence: { approvalRequired: [] } } }) },
    );
    assert.equal(d.allowed, false);
    assert.equal(d.source, 'role-authority.ungranted');
  });

  it('enterprise mode also denies an ungranted env-claimed role', () => {
    const identity = { ...serviceIdentity({ serviceId: 'role:release-manager', role: 'release-manager', source: 'env-fallback' }), grants: ['engineer'] };
    const d = policyDecision(
      { role: 'release-manager', tool: 'github', action: 'deploy', deploymentMode: 'enterprise', identity },
      { manifests: manifests({ 'release-manager': { fence: {} } }) },
    );
    assert.equal(d.allowed, false);
    assert.equal(d.source, 'role-authority.ungranted');
  });

  it('implicit-solo identity in team mode still denies at the identity boundary (unchanged precedence)', () => {
    const identity = serviceIdentity({ serviceId: 'local-host', role: 'engineer', source: 'implicit-solo' });
    const d = policyDecision(
      { role: 'engineer', tool: 'bash', action: 'bash:run', deploymentMode: 'team', identity },
      { manifests: manifests({ engineer: { fence: {} } }) },
    );
    assert.equal(d.allowed, false);
    assert.equal(d.source, 'identity-boundary');
  });
});

describe('policyDecision — solo mode unchanged', () => {
  it('solo mode allows regardless of identity/grants (env ergonomics preserved)', () => {
    const identity = serviceIdentity({ serviceId: 'role:security', role: 'security', source: 'env-fallback' });
    const d = policyDecision(
      { role: 'security', tool: 'bash', action: 'bash:run', deploymentMode: 'solo', identity },
      { manifests: manifests({ security: { fence: {} } }) },
    );
    assert.equal(d.allowed, true, `expected allow, got: ${d.reason}`);
    assert.equal(d.source, 'default');
  });

  it('solo mode allows with no identity passed at all (existing call shape)', () => {
    const d = policyDecision(
      { role: 'engineer', tool: 'bash', action: 'bash:run' },
      { manifests: manifests({ engineer: { fence: {} } }) },
    );
    assert.equal(d.allowed, true);
  });

  it('omitting identity in team mode does not engage the authority gate (backward compatible call shape)', () => {
    // Existing call sites that pass deploymentMode without identity (e.g.
    // tests/policy-deny-default.test.mjs) must keep behaving exactly as
    // before — the gate only activates when an identity is actually present.
    const d = policyDecision(
      { role: 'engineer', tool: 'bash', action: 'bash:run', deploymentMode: 'team' },
      { manifests: manifests({ engineer: { fence: {} } }) },
    );
    assert.equal(d.allowed, false);
    assert.equal(d.source, 'deny-by-default');
  });
});
