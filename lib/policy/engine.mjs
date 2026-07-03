/**
 * lib/policy/engine.mjs — role-based policy decisions for tool / action access.
 *
 * Reads role permissions from the unified registry and decides
 * whether a given (role, project, tool, action, risk) tuple is allowed,
 * needs approval, or is denied outright. Powers the MCP broker for team
 * and enterprise deployments; solo mode leaves the broker off so this
 * engine returns allow-without-approval everywhere.
 *
 * Decision precedence:
 *   1. Team-level decisions gate specialist decisions — forbidden by team blocks the action.
 *   2. Explicit deny in the role's fence → denied + typed reason.
 *   3. Action falls in the role's approvalRequired list → allowed but
 *      approvalRequired = true (UI must collect human consent).
 *   4. risk === 'high' and role is not in HIGH_RISK_AUTONOMOUS → approval required.
 *   5. Deny-by-default: team → deny unless explicit grant; enterprise → deny always.
 *   6. solo → allowed.
 */

import { readFileSync, existsSync } from 'node:fs';
import { loadRegistry } from '../registry/loader.mjs';

const HIGH_RISK_AUTONOMOUS = new Set(['security', 'sre', 'release-manager']);

let cachedManifests = null;

/**
 * Find the team that owns a specialist/role.
 * Returns the team id if found, null otherwise.
 */
function findTeamForRole(roleId, registry) {
  if (!registry || !registry.teams) return null;
  for (const [teamId, team] of Object.entries(registry.teams)) {
    if (Array.isArray(team.roles) && team.roles.includes(roleId)) {
      return teamId;
    }
  }
  return null;
}

/**
 * Check if a role can make a decision at the team level.
 * Returns { allowed: boolean, reason: string }.
 */
function canRoleDecide(roleId, decisionId, registry) {
  const teamId = findTeamForRole(roleId, registry);
  if (!teamId) return { allowed: true, reason: 'no-team-restriction' };

  const team = registry.teams[teamId];
  if (!team) return { allowed: true, reason: 'team-not-found' };

  // Check forbidden decisions first — explicit blocks override everything
  if (Array.isArray(team.forbiddenDecisions) && team.forbiddenDecisions.includes(decisionId)) {
    return { allowed: false, reason: 'forbidden-by-team' };
  }

  // Check allowed decisions — team must explicitly grant it
  if (Array.isArray(team.decisionRights) && team.decisionRights.includes(decisionId)) {
    return { allowed: true, reason: 'authorized-by-team' };
  }

  // Default: if team doesn't forbid, allow (permissive default)
  return { allowed: true, reason: 'not-restricted-by-team' };
}

export function loadRoleManifests(manifestPath) {
  // Unified registry is canonical. Explicit manifestPath overrides exist only for tests.
  if (!manifestPath || !existsSync(manifestPath)) {
    const manifestPathKey = manifestPath || '__unified_registry__';
    if (cachedManifests && cachedManifests.path === manifestPathKey) return cachedManifests.data;
    const registry = loadRegistry();
    const personas = {};
    for (const [specId, spec] of Object.entries(registry.specialists || {})) {
      const personaId = specId.replace(/^cx-/, '');
      const teamId = findTeamForRole(personaId, registry);
      personas[personaId] = {
        events: spec.events || [],
        fence: spec.fence || {},
        outputs: { docTypes: spec.docArtifacts || [] },
        teamId: teamId || null,
      };
    }
    cachedManifests = { path: manifestPathKey, data: { personas, registry } };
    return cachedManifests.data;
  }
  if (cachedManifests && cachedManifests.path === manifestPath) return cachedManifests.data;
  const raw = readFileSync(manifestPath, 'utf8');
  const data = JSON.parse(raw);
  cachedManifests = { path: manifestPath, data };
  return data;
}

export function clearManifestCache() {
  cachedManifests = null;
}

function manifestFor(role, manifests) {
  return manifests?.personas?.[role] || null;
}

/**
 * Return the default decision for unclassified (no matching explicit rule) tool calls.
 *
 * - solo       → 'allow'               (unchanged permissive behaviour)
 * - team       → 'deny-unclassified'   (deny unless an explicit grant exists or the
 *                                       user escapes with an approval flow)
 * - enterprise → 'deny'               (hard deny regardless of approval escape)
 *
 * @param {'solo'|'team'|'enterprise'} deploymentMode
 * @returns {'allow'|'deny-unclassified'|'deny'}
 */
export function getDefaultDecision(deploymentMode) {
  switch (deploymentMode) {
    case 'enterprise': return 'deny';
    case 'team':       return 'deny-unclassified';
    default:           return 'allow'; // solo and unknown → permissive
  }
}

function actionMatches(pattern, action) {
  if (!pattern || !action) return false;
  if (pattern === action) return true;
  if (pattern.endsWith(':**')) return action.startsWith(pattern.slice(0, -3));
  if (pattern.endsWith('/**')) return action.startsWith(pattern.slice(0, -3));
  return false;
}

function isExplicitlyDenied(action, manifest) {
  const deny = manifest?.fence?.deniedActions || [];
  return deny.some((p) => actionMatches(p, action));
}

function needsApprovalFromManifest(action, manifest) {
  const list = manifest?.fence?.approvalRequired || [];
  return list.some((p) => actionMatches(p, action));
}

/**
 * Decide whether a tool / action is allowed for a role.
 *
 * @param {object} input
 * @param {string} input.role
 * @param {string} [input.project]
 * @param {string} input.tool
 * @param {string} input.action
 * @param {string} [input.decision] — optional decision id for team-level gate
 * @param {string} [input.risk]
 * @param {'solo'|'team'|'enterprise'} [input.deploymentMode='solo'] — controls deny-by-default behaviour
 * @param {object} [opts]
 * @returns {{allowed: boolean, reason: string, approvalRequired: boolean, source: string}}
 */
export function policyDecision(input = {}, opts = {}) {
  const { role, tool, action, decision, risk = 'low', deploymentMode = 'solo', identity } = input;
  if (!role) return { allowed: false, reason: 'role is required', approvalRequired: false, source: 'engine' };
  if (!tool) return { allowed: false, reason: 'tool is required', approvalRequired: false, source: 'engine' };
  if (!action) return { allowed: false, reason: 'action is required', approvalRequired: false, source: 'engine' };

  if ((deploymentMode === 'team' || deploymentMode === 'enterprise') && identity) {
    if (identity.source === 'implicit-solo') {
      return { allowed: false, reason: `Identity not resolved for ${deploymentMode} mode`, approvalRequired: false, source: 'identity-boundary' };
    }
  }

  const manifests = opts.manifests || loadRoleManifests(opts.manifestPath);
  const manifest = manifestFor(role, manifests);

  if (!manifest) {
    return {
      allowed: false,
      reason: `no role manifest for "${role}"; explicit allowlist required for tool access in team / enterprise mode`,
      approvalRequired: false,
      source: 'engine',
    };
  }

  // Team decision gate: if a decision id is supplied, check team-level authorization first
  if (decision && manifests.registry) {
    const teamDecision = canRoleDecide(role, decision, manifests.registry);
    if (!teamDecision.allowed) {
      return {
        allowed: false,
        reason: `decision "${decision}" forbidden for team of role "${role}": ${teamDecision.reason}`,
        approvalRequired: false,
        source: 'team.forbiddenDecisions',
      };
    }
  }

  if (isExplicitlyDenied(action, manifest)) {
    return {
      allowed: false,
      reason: `action "${action}" is in deny list for role "${role}"`,
      approvalRequired: false,
      source: 'manifest.deniedActions',
    };
  }

  if (needsApprovalFromManifest(action, manifest)) {
    return {
      allowed: true,
      reason: `action "${action}" requires approval per role "${role}" manifest`,
      approvalRequired: true,
      source: 'manifest.approvalRequired',
    };
  }

  if (risk === 'high' && !HIGH_RISK_AUTONOMOUS.has(role)) {
    return {
      allowed: true,
      reason: `high-risk action "${action}" needs approval for non-autonomous role "${role}"`,
      approvalRequired: true,
      source: 'risk-tier',
    };
  }

  // Deny-by-default for team and enterprise modes.
  // No explicit rule granted this action — consult the deployment-mode default.
  const defaultDecision = getDefaultDecision(deploymentMode);
  if (defaultDecision === 'deny') {
    return {
      allowed: false,
      reason: 'deny-by-default',
      approvalRequired: false,
      mode: deploymentMode,
      source: 'deny-by-default',
    };
  }
  if (defaultDecision === 'deny-unclassified') {
    return {
      allowed: false,
      reason: 'deny-by-default',
      approvalRequired: false,
      mode: deploymentMode,
      source: 'deny-by-default',
    };
  }

  return {
    allowed: true,
    reason: `action "${action}" permitted for role "${role}"`,
    approvalRequired: false,
    source: 'default',
  };
}
