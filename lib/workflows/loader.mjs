/**
 * lib/workflows/loader.mjs — workflow manifest directory loader and merger.
 *
 * Three manifest tiers exist: builtin (shipped with Construct in
 * lib/embedded-contract/workflows/), pack (in {pack_root}/workflows/), and
 * project (in .cx/workflows/). Project manifests take highest precedence;
 * pack manifests override builtin.
 *
 * `loadWorkflowManifestsFromDir` reads every *.manifest.json in a directory and
 * validates each one. Errors are collected without throwing. `mergeWorkflowManifests`
 * merges up to three tiers by id. `resolveWorkflowManifestDirs` returns the
 * canonical paths for each tier.
 *
 * Provenance (LMCP-D3): every loaded manifest carries `_source` ('builtin' |
 * 'pack' | 'project') and `_filePath`. When a higher tier overrides a lower
 * tier's id, `mergeWorkflowManifests` records the overridden entries on the
 * winner as `_shadowedBy` so a caller (e.g. `construct graph explain`) can
 * show which source won and what it overrode without re-reading disk.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateWorkflowManifest } from './validate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Root of the Construct package (parent of lib/). */
const PACKAGE_ROOT = resolve(__dirname, '..', '..');

/**
 * loadWorkflowManifestsFromDir(dirPath, { strict } = {})
 *
 * Reads all `*.manifest.json` files in dirPath, validates each one, and
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
export function loadWorkflowManifestsFromDir(dirPath, { strict = false, source = 'unknown' } = {}) {
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

    const result = validateWorkflowManifest(parsed, { filePath, strict });
    if (!result.valid) {
      errors.push(...result.errors);
      continue;
    }

    manifests.push({ ...parsed, _filePath: filePath, _source: source });
  }

  return { manifests, errors };
}

/**
 * mergeWorkflowManifests(builtin, pack, project)
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
export function mergeWorkflowManifests(builtin = [], pack = [], project = []) {
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
 * resolveWorkflowManifestDirs({ rootDir, packRoots })
 *
 * Returns the canonical directory paths for each workflow manifest tier.
 *
 * @param {{ rootDir?: string, packRoots?: string[] }} opts
 * @returns {{ builtin: string, pack: string[], project: string }}
 */
export function resolveWorkflowManifestDirs({ rootDir = process.cwd(), packRoots = [] } = {}) {
  return {
    builtin: join(PACKAGE_ROOT, 'lib', 'embedded-contract', 'workflows'),
    pack: (packRoots || []).map((pr) => join(pr, 'workflows')),
    project: join(rootDir, '.cx', 'workflows'),
  };
}

/**
 * loadAllWorkflows(opts)
 *
 * Convenience function that discovers, loads, and merges all workflow manifests
 * across all three tiers. Returns the merged list of manifests and any errors
 * encountered.
 *
 * @param {{ rootDir?: string, packRoots?: string[], strict?: boolean }} opts
 * @returns {{ workflows: object[], errors: string[] }}
 */
export function loadAllWorkflows(opts = {}) {
  const { rootDir, packRoots = [], strict = false } = opts;
  const errors = [];

  const dirs = resolveWorkflowManifestDirs({ rootDir, packRoots });

  const builtin = loadWorkflowManifestsFromDir(dirs.builtin, { strict, source: 'builtin' });
  errors.push(...builtin.errors);

  const packManifests = [];
  for (const packDir of dirs.pack) {
    const result = loadWorkflowManifestsFromDir(packDir, { strict, source: 'pack' });
    packManifests.push(...result.manifests);
    errors.push(...result.errors);
  }

  const project = loadWorkflowManifestsFromDir(dirs.project, { strict, source: 'project' });
  errors.push(...project.errors);

  const workflows = mergeWorkflowManifests(builtin.manifests, packManifests, project.manifests);

  return { workflows, errors };
}