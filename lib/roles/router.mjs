/**
 * lib/roles/router.mjs — pure event → persona resolver.
 *
 * Reads ownership from the declarative routing tables built off of
 * specialists/org, then validates against the loaded role
 * manifest. Returns null silently when the event has no declared owner
 * or the persona is not yet onboarded — letting ownership be declared
 * ahead of full wiring.
 */

import { ownerForEvent } from '../orchestration/routing-tables.mjs';
import { loadManifest, isOnboarded } from './manifest.mjs';

export function route(event) {
  const type = event?.type;
  if (!type) return null;
  const ownerCxId = ownerForEvent(type);
  if (!ownerCxId) return null;
  const personaId = ownerCxId.replace(/^cx-/, '');
  if (!isOnboarded(personaId)) return null;
  const manifest = loadManifest(personaId);
  if (!manifest.events.includes(type)) return null;
  return { personaId, cxId: ownerCxId, manifest };
}

export function ownerOf(eventType) {
  return ownerForEvent(eventType);
}
