/**
 * lib/roles/router.mjs — pure event → persona resolver.
 *
 * Uses EVENT_OWNERSHIP from orchestration-policy and validates against
 * the loaded role manifest. Returns null (no owner) silently if the
 * event has no declared owner or the persona is not yet onboarded —
 * letting us declare ownership ahead of full wiring.
 */

import { EVENT_OWNERSHIP } from '../orchestration-policy.mjs';
import { loadManifest, isOnboarded } from './manifest.mjs';

export function route(event) {
  const type = event?.type;
  if (!type) return null;
  const ownerCxId = EVENT_OWNERSHIP[type];
  if (!ownerCxId) return null;
  const personaId = ownerCxId.replace(/^cx-/, '');
  if (!isOnboarded(personaId)) return null;
  const manifest = loadManifest(personaId);
  if (!manifest.events.includes(type)) return null;
  return { personaId, cxId: ownerCxId, manifest };
}

export function ownerOf(eventType) {
  return EVENT_OWNERSHIP[eventType] || null;
}
