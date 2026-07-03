/**
 * lib/packs/loader.mjs — pack manifest directory loader and merger.
 *
 * Three manifest tiers exist: builtin (shipped with Construct), user (in
 * ~/.config/construct/packs/), and project (in .cx/packs/). Project packs
 * take highest precedence; user packs override builtin. The core pack is
 * programmatically injected at the builtin tier via loadCorePack().
 *
 * `loadPacksFromDir` reads every subdirectory containing pack.manifest.json
 * and validates each one. `mergePackTiers` merges the three tiers by id.
 * `resolvePackDirs` returns the canonical paths for each tier.
 * `loadAllPacks` is a convenience that loads from all tiers.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePackManifest } from './validate.mjs';
import { loadCorePack } from './core-pack.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..', '..');

export function loadPacksFromDir(packsBaseDir, opts = {}) {
  const packs = [];
  const errors = [];

  if (!existsSync(packsBaseDir)) {
    return { packs, errors };
  }

  let entries;
  try {
    entries = readdirSync(packsBaseDir, { withFileTypes: true });
  } catch (err) {
    errors.push(`${packsBaseDir}: failed to read directory (${err.message})`);
    return { packs, errors };
  }

  const packDirs = entries.filter(e => e.isDirectory()).map(e => join(packsBaseDir, e.name)).sort();

  for (const packDir of packDirs) {
    const manifestPath = join(packDir, 'pack.manifest.json');
    if (!existsSync(manifestPath)) continue;

    let parsed;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      errors.push(`${manifestPath}: failed to parse JSON (${err.message})`);
      continue;
    }

    const result = validatePackManifest(parsed, { filePath: manifestPath, strict: opts.strict });
    if (!result.valid) {
      errors.push(...result.errors);
      continue;
    }

    packs.push({ ...parsed, _tier: opts.tier || 'unknown', _manifestPath: manifestPath, _packDir: packDir });
  }

  return { packs, errors };
}

export function mergePackTiers(builtin = [], user = [], project = []) {
  const map = new Map();

  for (const p of builtin) map.set(p.id, p);
  for (const p of user) map.set(p.id, p);
  for (const p of project) map.set(p.id, p);

  return [...map.values()];
}

export function resolvePackDirs({ rootDir, homeDir } = {}) {
  const home = homeDir ?? (process.env.HOME || process.env.USERPROFILE || '');

  return {
    builtin: join(PACKAGE_ROOT, 'lib', 'packs', 'manifests'),
    user: join(home, '.config', 'construct', 'packs'),
    project: join(rootDir || process.cwd(), '.cx', 'packs'),
  };
}

export function loadAllPacks(opts = {}) {
  const dirs = resolvePackDirs(opts);
  const allErrors = [];

  const builtinResult = loadPacksFromDir(dirs.builtin, { ...opts, tier: 'builtin' });
  allErrors.push(...builtinResult.errors);

  const userResult = loadPacksFromDir(dirs.user, { ...opts, tier: 'user' });
  allErrors.push(...userResult.errors);

  const projectResult = loadPacksFromDir(dirs.project, { ...opts, tier: 'project' });
  allErrors.push(...projectResult.errors);

  const corePack = loadCorePack(opts.rootDir || PACKAGE_ROOT);
  const builtinPacks = [...builtinResult.packs, corePack];

  const merged = mergePackTiers(builtinPacks, userResult.packs, projectResult.packs);

  return { packs: merged, errors: allErrors };
}