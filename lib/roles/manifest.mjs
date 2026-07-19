/**
 * lib/roles/manifest.mjs — role manifest loader.
 *
 * Reads Worker Profile data from the canonical registry.
 * A Worker Profile is "onboarded" when its `events` array is non-empty. Empty entries reserve
 * the slot for future wiring without code change.
 */

import { loadRegistry } from '../registry/loader.mjs';

let cached = null;

function load() {
  if (cached) return cached;
  const registry = loadRegistry();
  const profiles = {};
  for (const [workerProfileId, profile] of Object.entries(registry.workerProfiles)) {
    profiles[workerProfileId] = {
      events: profile.events || [],
      severityImmediate: profile.severityImmediate || [],
      killSwitchEnv: profile.killSwitchEnv || '',
      fence: profile.policyFence || {},
      handoffCandidates: profile.handoffCandidates || [],
      outputs: {
        docTypes: profile.artifactClasses || [],
      },
    };
  }
  cached = profiles;
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
