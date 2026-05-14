/**
 * lib/roles/fence.mjs — pure action-vs-manifest fence check.
 *
 * Invoked from the policy-engine and edit-guard hooks when a session is
 * tagged with a persona. Glob patterns use simple ** / * matching (no full
 * minimatch).
 *
 * Decision semantics:
 *   - allowed:    target is inside the persona's allowedPaths/Commands/Labels
 *   - approval:   target matches an entry in approvalRequired (needs user yes)
 *   - denied:     neither — default deny
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

export function checkAction({ personaId, action, target = '' }) {
  const manifest = loadManifest(personaId);
  if (!manifest) return { allowed: false, reason: 'persona-not-onboarded' };
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
