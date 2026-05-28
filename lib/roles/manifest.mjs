/**
 * lib/roles/manifest.mjs — role manifest loader.
 *
 * Reads specialists/role-manifests.json. A persona is "onboarded" when its
 * `events` array is non-empty. Empty entries reserve the slot for future
 * wiring without code change.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, '..', '..', 'specialists', 'role-manifests.json');

let cached = null;

function load() {
  if (cached) return cached;
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  cached = parsed.personas || {};
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
