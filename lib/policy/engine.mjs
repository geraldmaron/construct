/**
 * lib/policy/engine.mjs — role-based policy decisions for tool / action access.
 *
 * Reads role permissions from `agents/role-manifests.json` and decides
 * whether a given (role, project, tool, action, risk) tuple is allowed,
 * needs approval, or is denied outright. Powers the MCP broker for team
 * and enterprise deployments; solo mode leaves the broker off so this
 * engine returns allow-without-approval everywhere.
 *
 * Decision precedence:
 *   1. Explicit deny in the role's fence → denied + typed reason.
 *   2. Action falls in the role's approvalRequired list → allowed but
 *      approvalRequired = true (UI must collect human consent).
 *   3. risk === 'high' and role is not in HIGH_RISK_AUTONOMOUS → approval required.
 *   4. Otherwise → allowed.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST_PATH = path.join(MODULE_DIR, '..', '..', 'agents', 'role-manifests.json');

const HIGH_RISK_AUTONOMOUS = new Set(['security', 'sre', 'release-manager']);

let cachedManifests = null;

export function loadRoleManifests(manifestPath = DEFAULT_MANIFEST_PATH) {
  if (cachedManifests && cachedManifests.path === manifestPath) return cachedManifests.data;
  if (!existsSync(manifestPath)) {
    cachedManifests = { path: manifestPath, data: { personas: {} } };
    return cachedManifests.data;
  }
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
 * @param {string} [input.risk]
 * @param {object} [opts]
 * @returns {{allowed: boolean, reason: string, approvalRequired: boolean, source: string}}
 */
export function policyDecision(input = {}, opts = {}) {
  const { role, tool, action, risk = 'low' } = input;
  if (!role) return { allowed: false, reason: 'role is required', approvalRequired: false, source: 'engine' };
  if (!tool) return { allowed: false, reason: 'tool is required', approvalRequired: false, source: 'engine' };
  if (!action) return { allowed: false, reason: 'action is required', approvalRequired: false, source: 'engine' };

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

  return {
    allowed: true,
    reason: `action "${action}" permitted for role "${role}"`,
    approvalRequired: false,
    source: 'default',
  };
}
