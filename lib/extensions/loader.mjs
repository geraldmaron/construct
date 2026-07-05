/**
 * lib/extensions/loader.mjs — extension manifest directory loader and merger.
 *
 * Three manifest tiers exist: builtin (shipped with Construct), user (in
 * ~/.config/construct/providers/), and project (in .cx/providers/). Project
 * manifests take highest precedence; user manifests override builtin.
 *
 * `loadManifestsFromDir` reads every *.manifest.json in a directory and
 * validates each one. Errors are collected without throwing. `mergeManifests`
 * merges the three tiers by id. `resolveManifestDirs` returns the canonical
 * paths for each tier.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateManifest } from './validate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Root of the Construct package (parent of lib/). */
const PACKAGE_ROOT = resolve(__dirname, '..', '..');

/**
 * loadManifestsFromDir(dirPath, { strict } = {})
 *
 * Reads all `*.manifest.json` files in dirPath, validates each one, and
 * returns a result object. Files that fail JSON parsing or validation are
 * collected in `errors`; valid manifests are collected in `manifests`.
 *
 * When `strict` is true, manifests are validated with the strict-mode
 * hardening checks (unknown field rejection, env key allowlist, etc.).
 *
 * @param {string} dirPath - Absolute path to search.
 * @param {{ strict?: boolean }} [opts]
 * @returns {{ manifests: object[], errors: string[] }}
 */
export function loadManifestsFromDir(dirPath, { strict = false } = {}) {
  const manifests = [];
  const errors = [];

  if (!existsSync(dirPath)) {
    return { manifests, errors };
  }

  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    errors.push(`${dirPath}: failed to read directory (${err.message})`);
    return { manifests, errors };
  }

  const manifestFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.manifest.json'))
    .map((e) => join(dirPath, e.name))
    .sort();

  for (const filePath of manifestFiles) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (err) {
      errors.push(`${filePath}: failed to parse JSON (${err.message})`);
      continue;
    }

    const result = validateManifest(parsed, { filePath, strict });
    if (!result.valid) {
      errors.push(...result.errors);
      continue;
    }

    manifests.push({ ...parsed, _filePath: filePath });
  }

  return { manifests, errors };
}

/**
 * mergeManifests(builtin, user, project)
 *
 * Merges three manifest arrays by `id`. Precedence (highest wins): project >
 * user > builtin. When multiple tiers declare the same id, only the
 * highest-precedence entry is kept.
 *
 * @param {object[]} builtin
 * @param {object[]} user
 * @param {object[]} project
 * @returns {object[]}
 */
export function mergeManifests(builtin = [], user = [], project = []) {
  const map = new Map();

  // Load lowest priority first so higher priority layers overwrite.
  for (const m of builtin) map.set(m.id, m);
  for (const m of user) map.set(m.id, m);
  for (const m of project) map.set(m.id, m);

  return [...map.values()];
}

/**
 * resolveManifestDirs({ rootDir, homeDir })
 *
 * Returns the canonical directory paths for each manifest tier.
 *
 * @param {{ rootDir?: string, homeDir?: string }} opts
 * @returns {{ builtin: string, user: string, project: string }}
 */
export function resolveManifestDirs({ rootDir = process.cwd(), homeDir } = {}) {
  const home = homeDir ?? (process.env.HOME || process.env.USERPROFILE || '');

  return {
    builtin: join(PACKAGE_ROOT, 'lib', 'extensions', 'manifests'),
    user: join(home, '.config', 'construct', 'providers'),
    project: join(rootDir, '.cx', 'providers'),
  };
}
