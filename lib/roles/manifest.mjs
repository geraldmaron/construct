/**
 * lib/roles/manifest.mjs — role manifest loader.
 *
 * Reads role manifest data from the unified registry (specialists/org).
 * A persona is "onboarded" when its `events` array is non-empty. Empty entries reserve
 * the slot for future wiring without code change.
 */

import { loadRegistry } from '../registry/loader.mjs';

let cached = null;

function load() {
  if (cached) return cached;
  const registry = loadRegistry();
  // Extract personas from specialists: map specialist events/fence to persona format
  const personas = {};
  for (const [specId, spec] of Object.entries(registry.workerProfiles)) {
    const personaId = specId.replace(/^cx-/, '');
    personas[personaId] = {
      events: spec.events || [],
      severityImmediate: spec.severityImmediate || [],
      killSwitchEnv: spec.killSwitchEnv || '',
      fence: spec.fence || {},
      handoffCandidates: spec.handoffCandidates || [],
      outputs: {
        docTypes: spec.docArtifacts || [],
      },
    };
  }
  cached = personas;
  return cached;
}

export function loadManifest(personaId) {
  const id = String(personaId).replace(/^cx-/, '');
  const all = load();
  return all[id] || null;
}

export function isOnboarded(personaId) {
  const m = loadManifest(personaId);
  return !!(m && Array.isArray(m.events) && m.events.length > 0);
}

export function listOnboardedPersonas() {
  const all = load();
  return Object.keys(all).filter((id) => isOnboarded(id));
}

export function listAllPersonas() {
  return Object.keys(load());
}

export function _resetCache() {
  cached = null;
}