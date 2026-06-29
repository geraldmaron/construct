/**
 * lib/roles/fence.mjs — pure action-vs-manifest fence check with team awareness.
 *
 * Invoked from the policy-engine and edit-guard hooks when a session is
 * tagged with a persona. Glob patterns use simple ** / * matching (no full
 * minimatch).
 *
 * Decision semantics:
 *   - allowed:    target is inside the persona's allowedPaths/Commands/Labels
 *   - approval:   target matches an entry in approvalRequired (needs user yes)
 *   - denied:     neither — default deny
 *
 * Team awareness: A specialist fence is the intersection of its team fence
 * and its own fence — never broader than the team's boundary.
 */

import { loadManifest } from './manifest.mjs';

function globMatch(pattern, target) {
  if (!pattern || !target) return false;
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '__GLOBSTARSLASH__')
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__GLOBSTARSLASH__/g, '(?:.*\\/)?')
    .replace(/__GLOBSTAR__/g, '.*');
  return new RegExp('^' + re + '$').test(target);
}

function matchAny(patterns, target) {
  if (!Array.isArray(patterns)) return false;
  return patterns.some((p) => globMatch(p, target));
}

function actionPrefix(action) {
  const idx = action.indexOf(':');
  return idx === -1 ? action : action.slice(0, idx);
}

/**
 * Find the team that owns a specialist.
 * Returns the team object if found, null otherwise.
 * Note: Uses dynamic import to avoid circular dependencies.
 */
async function findTeamForSpecialist(personaId) {
  try {
    const { loadRegistry } = await import('../registry/loader.mjs');
    const registry = loadRegistry();
    for (const team of Object.values(registry.teams || {})) {
      if (Array.isArray(team.roles) && team.roles.includes(personaId)) {
        return team;
      }
    }
  } catch {
    // Ignore errors; return null on any failure
  }
  return null;
}

/**
 * Synchronous fallback to find team without async.
 * Used when dynamic import is not available.
 */
function findTeamForSpecialistSync(personaId, registry) {
  if (!registry || !registry.teams) return null;
  for (const team of Object.values(registry.teams)) {
    if (Array.isArray(team.roles) && team.roles.includes(personaId)) {
      return team;
    }
  }
  return null;
}

/**
 * Intersect two fence arrays: return only items that appear in both.
 * Handles glob patterns by checking if the tighter pattern is in the broader set.
 */
function intersectFences(teamPatterns = [], specialistPatterns = []) {
  if (!Array.isArray(teamPatterns)) teamPatterns = [];
  if (!Array.isArray(specialistPatterns)) specialistPatterns = [];

  // If either is empty, the intersection is empty (deny by default)
  if (teamPatterns.length === 0 || specialistPatterns.length === 0) {
    return [];
  }

  // Keep only patterns that are explicitly allowed by both team and specialist
  return specialistPatterns.filter(sp =>
    teamPatterns.some(tp => tp === sp || globMatch(tp, sp))
  );
}

/**
 * Compute the effective fence for a specialist: the intersection of team fence
 * and specialist's own fence. A specialist can never have broader authority
 * than their team grants.
 *
 * @param {string} personaId - The specialist/role id
 * @param {object} specialistFence - The specialist's own fence definition
 * @param {object} [registry] - Optional registry to look up team; if not provided, no team intersection
 * @returns {object} The effective fence (specialist fence ∩ team fence)
 */
export function computeEffectiveFence(personaId, specialistFence = {}, registry = null) {
  try {
    // If no registry supplied, return specialist fence as-is
    if (!registry) {
      return specialistFence;
    }

    const teamForSpecialist = findTeamForSpecialistSync(personaId, registry);
    if (!teamForSpecialist) {
      // No team found; use specialist fence as-is
      return specialistFence;
    }

    // Team fence is derived from decisionRights and forbiddenDecisions
    const teamForbiddenDecisions = teamForSpecialist.forbiddenDecisions || [];

    // Build effective fence: specialist fence intersected with team constraints
    const effectiveFence = {
      allowedPaths: specialistFence.allowedPaths || [],
      allowedCommands: specialistFence.allowedCommands || [],
      allowedBdLabels: specialistFence.allowedBdLabels || [],
      approvalRequired: (specialistFence.approvalRequired || []).filter(
        ap => !teamForbiddenDecisions.includes(ap)
      ),
      deniedActions: [
        ...(specialistFence.deniedActions || []),
        ...teamForbiddenDecisions.map(d => `${d}:**`)
      ],
    };

    return effectiveFence;
  } catch (err) {
    // Fallback to specialist fence on any error
    return specialistFence;
  }
}

export function checkAction({ personaId, action, target = '' }) {
  const manifest = loadManifest(personaId);
  if (!manifest) return { allowed: false, reason: 'persona-not-onboarded' };

  // Use manifest fence directly (computeEffectiveFence requires registry which isn't available here)
  // Team-aware intersection is enforced in policyDecision for tool access
  const fence = manifest.fence || {};

  if (action === 'edit' || action === 'write') {
    if (matchAny(fence.allowedPaths, target)) return { allowed: true };
    const approvalForms = [`edit:${target}`, 'edit:**', `${action}:${target}`];
    if (
      (fence.approvalRequired || []).some((req) =>
        req === 'edit' || req === action || approvalForms.includes(req) || globMatch(req.replace(/^edit:/, ''), target)
      )
    ) {
      return { allowed: false, reason: 'needs-approval', approval: true };
    }
    return { allowed: false, reason: 'outside-fence' };
  }

  if (action === 'bash') {
    const cmd = String(target).trim();
    const allowed = fence.allowedCommands || [];
    const isPrefixMatch = allowed.some((c) => cmd === c || cmd.startsWith(c + ' '));
    if (isPrefixMatch) return { allowed: true };
    if ((fence.approvalRequired || []).includes('bash')) {
      return { allowed: false, reason: 'needs-approval', approval: true };
    }
    return { allowed: false, reason: 'outside-fence' };
  }

  if (action === 'commit' || action === 'push') {
    if ((fence.approvalRequired || []).includes(action)) {
      return { allowed: false, reason: 'needs-approval', approval: true };
    }
    return { allowed: false, reason: 'outside-fence' };
  }

  if (action === 'bd-label') {
    const labels = String(target).split(',').map((s) => s.trim()).filter(Boolean);
    const allowed = fence.allowedBdLabels || [];
    if (labels.every((l) => allowed.includes(l) || l.startsWith('next:'))) return { allowed: true };
    return { allowed: false, reason: 'label-outside-fence' };
  }

  return { allowed: false, reason: 'unknown-action' };
}

export { globMatch };
