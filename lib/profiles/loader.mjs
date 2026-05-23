/**
 * lib/profiles/loader.mjs — Curated and custom org-type profile loader.
 *
 * Reads JSON profiles from `<repo>/profiles/<id>.json` for the curated set
 * (rnd, marketing, game-studio, internal-tools), and from `<cwd>/.cx/profile.json`
 * for user-defined profiles when `custom: true`.
 *
 * Resolution order for the active profile:
 *   1. `construct.config.json` -> `profile`
 *   2. `<cwd>/.cx/profile.json` -> `id` (custom)
 *   3. Default: 'rnd'
 *
 * All errors fall back to 'rnd' so a malformed profile never breaks the CLI.
 * Validation surfaces in `npm run lint:profiles` and in B3's pre-push gate.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, '..', '..');
const PROFILES_DIR = join(REPO_ROOT, 'profiles');

export const DEFAULT_PROFILE_ID = 'rnd';

/**
 * Read a profile by id from the curated catalog. Returns null if not found.
 */
export function loadProfile(id) {
  if (!id || typeof id !== 'string') return null;
  const path = join(PROFILES_DIR, `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return raw;
  } catch {
    return null;
  }
}

/**
 * List every curated profile id by scanning the profiles directory.
 */
export function listProfiles() {
  if (!existsSync(PROFILES_DIR)) return [];
  return readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/**
 * Load a user-defined profile from `<cwd>/.cx/profile.json`. Returns null if
 * the file is missing, malformed, or does not have `custom: true`.
 */
export function loadCustomProfile(cwd) {
  if (!cwd) return null;
  const path = join(cwd, '.cx', 'profile.json');
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (raw && raw.custom === true) return raw;
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve the active profile for a project. Always returns a profile object.
 *
 * Precedence (highest first):
 *   1. Explicit `configProfileId` argument
 *   2. `<cwd>/.cx/profile.json` with `custom: true`
 *   3. `profile` field in `<cwd>/construct.config.json`
 *   4. Default `rnd`
 *
 * Falls back to a minimal RND object on any miss so the CLI never breaks.
 *
 * @param {string} cwd - project root
 * @param {string} [configProfileId] - explicit override, bypasses file lookups
 */
export function resolveActiveProfile(cwd, configProfileId = null) {
  if (configProfileId) {
    const p = loadProfile(configProfileId);
    if (p) return p;
  }
  const custom = loadCustomProfile(cwd);
  if (custom) return custom;
  const fromConfig = readProfileFromProjectConfig(cwd);
  if (fromConfig) {
    const p = loadProfile(fromConfig);
    if (p) return p;
  }
  return loadProfile(DEFAULT_PROFILE_ID) ?? minimalRndFallback();
}

function readProfileFromProjectConfig(cwd) {
  if (!cwd) return null;
  const p = join(cwd, 'construct.config.json');
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    return typeof raw?.profile === 'string' ? raw.profile : null;
  } catch {
    return null;
  }
}

// Last-resort fallback if the curated rnd profile file is missing or
// unreadable. Lets callers always rely on a non-null shape.
function minimalRndFallback() {
  return {
    id: 'rnd',
    displayName: 'Software R&D',
    roles: [],
    intake: { types: [], stages: [] },
    docTemplates: [],
    hooks: { sessionReflect: 'on', sessionOptimize: 'on' },
    rebrand: { intakeQueueLabel: 'R&D intake queue', signalNoun: 'signal' },
  };
}
