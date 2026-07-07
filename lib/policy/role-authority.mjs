/**
 * lib/policy/role-authority.mjs — identity-anchored role claim authority.
 *
 * A6/ADR-0056 requires policy decisions to bind to actor/service identity
 * (H2, lib/identity.mjs), not to a self-declared env var. Prior to this
 * module, `CONSTRUCT_ROLE` alone selected the role manifest a caller was
 * evaluated against — a worker could export the env var and claim any
 * role's authority, including `security` or `release-manager`, with no
 * check against who the identity actually is.
 *
 * `authorizeRoleClaim` closes that gap: it takes the resolved identity
 * (from resolveIdentity()) and the role claim under evaluation, and
 * decides whether the identity is entitled to act as that role.
 *
 * Registered-grants source: `identity.grants` — a list of role ids the
 * identity is registered for. This is the seam LMCP-G5 (worker
 * registration/heartbeat) and pack `toolGrantsRequested` (LMCP-E1) populate;
 * neither exists as a live registration store yet, so until G5 lands the
 * only way an identity acquires a grant is an explicit `identity.grants`
 * array set by the caller that resolved the identity (e.g. from a signed
 * header, a worker registration record, or test fixture). No implicit
 * grants are invented here — an identity with no `grants` array has none.
 *
 * Mode behavior:
 *   - solo: always authorized. CONSTRUCT_ROLE remains a documented
 *     solo-only convenience (lib/identity.mjs env fallback); there is no
 *     registration authority to check against in single-user mode.
 *   - team / enterprise: the claimed role must be present in the
 *     identity's `grants`. A role claim sourced from `env-fallback` (an
 *     env var with no actor identity headers at all) is never itself
 *     trusted as a grant — it is a claim, and claims are checked, not
 *     trusted. Missing or non-matching grants are DENIED (fail closed).
 */

export class RoleAuthorityError extends Error {
  constructor(message) { super(message); this.name = 'RoleAuthorityError'; }
}

/**
 * Return the set of role ids an identity is registered for.
 *
 * `identity.grants` is the only source read today (see file header for
 * why). Absent/malformed values resolve to an empty set — never to "all
 * roles" — so a caller who forgets to populate grants fails closed rather
 * than silently trusting the claim.
 *
 * @param {object} identity
 * @returns {Set<string>}
 */
export function resolveIdentityGrants(identity) {
  const grants = identity?.grants;
  if (!Array.isArray(grants)) return new Set();
  return new Set(grants.filter((g) => typeof g === 'string' && g.length > 0));
}

/**
 * Decide whether `role` is an authorized claim for `identity` under
 * `deploymentMode`.
 *
 * @param {object} input
 * @param {object} input.identity - resolved identity (lib/identity.mjs shape)
 * @param {string} input.role - the role claim under evaluation
 * @param {'solo'|'team'|'enterprise'} [input.deploymentMode='solo']
 * @returns {{authorized: boolean, reason: string, source: string}}
 */
export function authorizeRoleClaim({ identity, role, deploymentMode = 'solo' } = {}) {
  if (!role) {
    return { authorized: false, reason: 'role claim is required', source: 'role-authority' };
  }

  if (deploymentMode !== 'team' && deploymentMode !== 'enterprise') {
    return { authorized: true, reason: 'solo mode: env-claimed role permitted (documented convenience)', source: 'solo-ergonomics' };
  }

  if (!identity) {
    return { authorized: false, reason: `no identity resolved to validate role claim "${role}" in ${deploymentMode} mode`, source: 'role-authority' };
  }

  const grants = resolveIdentityGrants(identity);
  if (grants.has(role)) {
    return { authorized: true, reason: `role "${role}" is a registered grant for this identity`, source: 'identity-grant' };
  }

  return {
    authorized: false,
    reason: `role claim "${role}" is not in this identity's registered grants in ${deploymentMode} mode`,
    source: 'role-authority.ungranted',
  };
}
