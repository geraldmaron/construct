/**
 * Canonical Procedure loader.
 *
 * Three manifest tiers exist: builtin (shipped with Construct in
 * registry/procedures/), pack (in {pack_root}/procedures/), and
 * project (in .construct/procedures/). Project records take highest precedence;
 * pack manifests override builtin.
 *
 * `loadProceduresFromDir` reads every JSON Procedure record in a directory and
 * validates each one. Errors are collected without throwing. `mergeProcedures`
 * merges up to three tiers by id. `resolveProcedureDirs` returns the
 * canonical paths for each tier.
 *
 * Provenance: every loaded manifest carries `_source` ('builtin' |
 * 'pack' | 'project') and `_filePath`. When a higher tier overrides a lower
 * tier's id, `mergeProcedures` records the overridden entries on the
 * winner as `_shadowedBy` so a caller (e.g. `construct graph explain`) can
 * show which source won and what it overrode without re-reading disk.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { configPath } from '../config-dir.mjs';
import { fileURLToPath } from 'node:url';

import { validateProcedure } from './validate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Root of the Construct package (parent of lib/). */
const PACKAGE_ROOT = resolve(__dirname, '..', '..');

/**
 * loadProceduresFromDir(dirPath, { strict } = {})
 *
 * Reads all `*.json` files in dirPath, validates each one, and
 * returns a result object. Files that fail JSON parsing or validation are
 * collected in `errors`; valid manifests are collected in `manifests`.
 *
 * When `strict` is true, manifests are validated with the strict-mode
 * hardening checks (unknown field rejection).
 *
 * @param {string} dirPath - Absolute path to search.
 * @param {{ strict?: boolean, source?: string }} [opts]
 * @returns {{ manifests: object[], errors: string[] }}
 */
export function loadProceduresFromDir(dirPath, { strict = false, source = 'unknown' } = {}) {
  const manifests = [];
  const errors = [];

  if (!dirPath || !existsSync(dirPath)) {
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
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
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

    const result = validateProcedure(parsed, { filePath, strict });
    if (!result.valid) {
      errors.push(...result.errors);
      continue;
    }

    manifests.push({ ...parsed, _filePath: filePath, _source: source });
  }

  return { manifests, errors };
}

/**
 * mergeProcedures(builtin, pack, project)
 *
 * Merges three manifest arrays by `id`. Precedence (highest wins): project >
 * pack > builtin. When multiple tiers declare the same id, only the
 * highest-precedence entry is kept.
 *
 * @param {object[]} builtin
 * @param {object[]} pack
 * @param {object[]} project
 * @returns {object[]}
 */
export function mergeProcedures(builtin = [], pack = [], project = []) {
  const map = new Map();
  const shadowed = new Map();

  const layer = (list) => {
    for (const m of list) {
      const existing = map.get(m.id);
      if (existing) {
        const log = shadowed.get(m.id) || [];
        log.push({ source: existing._source || 'unknown', filePath: existing._filePath || null });
        shadowed.set(m.id, log);
      }
      map.set(m.id, m);
    }
  };

  // Load lowest priority first so higher priority layers overwrite.
  layer(builtin);
  layer(pack);
  layer(project);

  for (const [id, winner] of map) {
    const log = shadowed.get(id);
    if (log?.length) winner._shadowedBy = log;
  }

  return [...map.values()];
}

/**
 * resolveProcedureDirs({ rootDir, packRoots })
 *
 * Returns the canonical directory paths for each Procedure tier.
 *
 * @param {{ rootDir?: string, packRoots?: string[] }} opts
 * @returns {{ builtin: string, pack: string[], project: string }}
 */
export function resolveProcedureDirs({ rootDir = process.cwd(), packRoots = [] } = {}) {
  return {
    builtin: join(PACKAGE_ROOT, 'registry', 'procedures'),
    pack: (packRoots || []).map((pr) => join(pr, 'procedures')),
    project: configPath(rootDir, 'procedures'),
  };
}

/**
 * loadAllProcedures(opts)
 *
 * Convenience function that discovers, loads, and merges all Procedures
 * across all three tiers. Returns the merged list of manifests and any errors
 * encountered.
 *
 * @param {{ rootDir?: string, packRoots?: string[], strict?: boolean }} opts
 * @returns {{ procedures: object[], errors: string[] }}
 */
export function loadAllProcedures(opts = {}) {
  const { rootDir, packRoots = [], strict = false } = opts;
  const errors = [];

  const dirs = resolveProcedureDirs({ rootDir, packRoots });

  const builtin = loadProceduresFromDir(dirs.builtin, { strict, source: 'builtin' });
  errors.push(...builtin.errors);

  const packManifests = [];
  for (const packDir of dirs.pack) {
    const result = loadProceduresFromDir(packDir, { strict, source: 'pack' });
    packManifests.push(...result.manifests);
    errors.push(...result.errors);
  }

  const project = loadProceduresFromDir(dirs.project, { strict, source: 'project' });
  errors.push(...project.errors);

  const procedures = mergeProcedures(builtin.manifests, packManifests, project.manifests);

  return { procedures, errors };
}
