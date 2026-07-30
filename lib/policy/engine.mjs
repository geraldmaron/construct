/**
 * lib/policy/engine.mjs — worker-profile policy decisions for tool / action access.
 *
 * Reads worker-profile fences and policies from the unified registry and decides
 * whether a given (worker profile, project, tool, action, risk) tuple is allowed,
 * needs approval, or is denied outright. Powers the MCP broker for managed
 * and enterprise deployments; solo mode leaves the broker off so this
 * engine returns allow-without-approval everywhere.
 *
 * Decision precedence:
 * 0. Mandatory-audit gate — enterprise only: if the audit sink is
 *      down, every action is denied fail-closed before any other check runs.
 *   1. Identity-anchored role authority — in team/enterprise, an
 *      env-claimed role not among the identity's registered grants is
 *      denied before any manifest is consulted.
 *   2. A governing policy veto for the worker profile blocks the decision.
 *   3. Explicit deny in the worker profile's fence → denied + typed reason.
 *   4. Action falls in the worker profile's approvalRequired list → allowed but
 *      approvalRequired = true (UI must collect human consent).
 *   5. risk === 'high' and role is not in HIGH_RISK_AUTONOMOUS → approval required.
 *   6. Deny-by-default: managed deployment → deny unless explicit grant; enterprise → deny always.
 *   7. solo → allowed.
 */

import { readFileSync, existsSync } from 'node:fs';
import { loadRegistry } from '../registry/loader.mjs';
import { authorizeRoleClaim } from './role-authority.mjs';
import { enforceMandatoryAudit } from './audit-gate.mjs';

const HIGH_RISK_AUTONOMOUS = new Set(['security', 'sre', 'release-manager']);

let cachedManifests = null;

/**
 * Evaluate policy vetoes that apply to a decision.
 * Returns { allowed: boolean, reason: string }.
 */
function evaluateDecisionPolicies(workerProfileId, decisionId, registry) {
  const governing = Object.values(registry?.policies ?? {})
    .filter((policy) => policy.governs?.includes(decisionId));
  for (const policy of governing) {
    if (policy.vetoWorkerProfiles?.includes(workerProfileId)) {
      return { allowed: false, reason: `vetoed-by-policy:${policy.id}`, policyId: policy.id };
    }
  }
  return { allowed: true, reason: governing.length ? 'no-policy-veto' : 'no-governing-policy' };
}

export function loadPolicyManifests(manifestPath) {
  // Unified registry is canonical. Explicit manifestPath overrides exist only for tests.
  if (!manifestPath || !existsSync(manifestPath)) {
    const manifestPathKey = manifestPath || '__unified_registry__';
    if (cachedManifests && cachedManifests.path === manifestPathKey) return cachedManifests.data;
    const registry = loadRegistry();
    const workerProfiles = {};
    for (const [profileId, profile] of Object.entries(registry.workerProfiles || {})) {
      workerProfiles[profileId] = {
        events: profile.events || [],
        fence: profile.policyFence || {},
        outputs: { artifactClasses: profile.artifactClasses || [] },
      };
    }
    cachedManifests = { path: manifestPathKey, data: { workerProfiles, registry } };
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
  return manifests?.workerProfiles?.[role] || null;
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
 * @param {object} [input.identity] — resolved actor/service identity (lib/identity.mjs). In
 *   team/enterprise, `input.role` is validated as a claim against this identity's registered
 *   grants (see lib/policy/role-authority.mjs) before any manifest lookup.
 * @param {object} [opts]
 * @param {function} [opts.checkSink] — injectable audit-sink probe for tests;
 *   defaults to the real fs-backed checkAuditSinkAvailable.
 * @returns {{allowed: boolean, reason: string, approvalRequired: boolean, source: string}}
 */
export function policyDecision(input = {}, opts = {}) {
  const { role, tool, action, decision, risk = 'low', deploymentMode = 'solo', identity } = input;
  if (!role) return { allowed: false, reason: 'role is required', approvalRequired: false, source: 'engine' };
  if (!tool) return { allowed: false, reason: 'tool is required', approvalRequired: false, source: 'engine' };
  if (!action) return { allowed: false, reason: 'action is required', approvalRequired: false, source: 'engine' };

  const auditGateDecision = enforceMandatoryAudit({
    deploymentMode,
    ...(opts.checkSink ? { checkSink: opts.checkSink } : {}),
  });
  if (auditGateDecision) return auditGateDecision;

  if ((deploymentMode === 'team' || deploymentMode === 'enterprise') && identity) {
    if (identity.source === 'implicit-solo') {
      return { allowed: false, reason: `Identity not resolved for ${deploymentMode} mode`, approvalRequired: false, source: 'identity-boundary' };
    }

    // Identity-anchored authority: the role claim under evaluation
    // must be among the identity's registered grants — an env-declared role
    // with no matching grant is denied before any manifest lookup runs.
    const authority = authorizeRoleClaim({ identity, role, deploymentMode });
    if (!authority.authorized) {
      return { allowed: false, reason: authority.reason, approvalRequired: false, source: authority.source };
    }
  }

  const manifests = opts.manifests || loadPolicyManifests(opts.manifestPath);
  const manifest = manifestFor(role, manifests);

  if (!manifest) {
    return {
      allowed: false,
      reason: `no role manifest for "${role}"; explicit allowlist required for tool access in team / enterprise mode`,
      approvalRequired: false,
      source: 'engine',
    };
  }

  // Policy decision gate: an applicable veto overrides the profile fence.
  if (decision && manifests.registry) {
    const policyResult = evaluateDecisionPolicies(role, decision, manifests.registry);
    if (!policyResult.allowed) {
      return {
        allowed: false,
        reason: `decision "${decision}" vetoed for worker profile "${role}" by policy "${policyResult.policyId}"`,
        approvalRequired: false,
        source: 'policy.vetoWorkerProfiles',
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
