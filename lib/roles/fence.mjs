/**
 * lib/roles/fence.mjs — pure action-vs-manifest fence check.
 *
 * Invoked from the policy-engine and edit-guard hooks when a session is
 * tagged with a Worker Profile. Glob patterns use simple ** / * matching (no full
 * minimatch).
 *
 * Decision semantics:
 *   - allowed:    target is inside the Worker Profile's allowedPaths/Commands/Labels
 *   - approval:   target matches an entry in approvalRequired (needs user yes)
 *   - denied:     neither — default deny
 *
 * Optional team intersection: when a caller supplies a registry object that
 * still carries a `teams` map (test fixtures / custom scaffolds),
 * computeEffectiveFence intersects the Worker Profile fence with that team's
 * forbiddenDecisions. The live canonical registry has no `teams` key — checkAction
 * always uses the Worker Profile fence alone.
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

function findTeamForWorkerProfileSync(workerProfileId, registry) {
  if (!registry || !registry.teams) return null;
  for (const team of Object.values(registry.teams)) {
    if (Array.isArray(team.roles) && team.roles.includes(workerProfileId)) {
      return team;
    }
  }
  return null;
}

/**
 * Compute the effective fence for a Worker Profile.
 *
 * When `registry` is omitted or has no matching team, returns the profile fence
 * unchanged. When a team is present, forbiddenDecisions tighten approvalRequired
 * and are appended to deniedActions — a profile never gains broader authority
 * than the supplied team grants.
 *
 * @param {string} workerProfileId - The Worker Profile id
 * @param {object} workerProfileFence - The profile's own fence definition
 * @param {object} [registry] - Optional registry with a `teams` map
 * @returns {object} The effective fence
 */
export function computeEffectiveFence(workerProfileId, workerProfileFence = {}, registry = null) {
  try {
    if (!registry) {
      return workerProfileFence;
    }

    const teamForSpecialist = findTeamForWorkerProfileSync(workerProfileId, registry);
    if (!teamForSpecialist) {
      return workerProfileFence;
    }

    const teamForbiddenDecisions = teamForSpecialist.forbiddenDecisions || [];

    return {
      allowedPaths: workerProfileFence.allowedPaths || [],
      allowedCommands: workerProfileFence.allowedCommands || [],
      allowedBdLabels: workerProfileFence.allowedBdLabels || [],
      approvalRequired: (workerProfileFence.approvalRequired || []).filter(
        (ap) => !teamForbiddenDecisions.includes(ap)
      ),
      deniedActions: [
        ...(workerProfileFence.deniedActions || []),
        ...teamForbiddenDecisions.map((d) => `${d}:**`),
      ],
    };
  } catch {
    return workerProfileFence;
  }
}

export function checkAction({ workerProfileId, action, target = '' }) {
  const manifest = loadManifest(workerProfileId);
  if (!manifest) return { allowed: false, reason: 'worker-profile-not-onboarded' };

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
