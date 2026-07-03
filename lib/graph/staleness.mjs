/**
 * lib/graph/staleness.mjs — per-source seed-hash staleness checks (LMCP-C6).
 *
 * `hashFiles`/GRAPH_SEED_FILES (build-from-registry.mjs) hash a flat file list
 * and cannot see inside a directory — the historical seed list has always
 * included whole-directory entries (specialists/org, docs) which `readFileSync`
 * silently treats as always-missing, so a change inside the directory never
 * moved the hash. `hashSourceGroup` fixes this by walking directories
 * recursively and hashing every file's relative path plus contents; a single
 * flat file hashes the same way. `SOURCE_GROUPS` names each seed source
 * (registry, overlays, specialists/org, plugin dirs, provider manifests,
 * workflow manifests) as its own group so `checkGraphStaleness` can report
 * exactly which source drifted, not just that something did. The legacy
 * combined `sourceHash` (single hash over the flat GRAPH_SEED_FILES list) is
 * preserved for existing consumers (lib/oracle/read-model.mjs) that compare
 * against it directly.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { hashFiles } from './build-from-registry.mjs';
import { loadGraph } from './store.mjs';
import { resolveManifestDirs } from '../extensions/loader.mjs';
import { resolveWorkflowManifestDirs } from '../workflows/loader.mjs';

export const GRAPH_SEED_FILES = [
  'registry/capabilities.json',
  'specialists/org',
  'lib/embedded-contract/workflow-defs.mjs',
  'lib/extensions/manifest-schema.mjs',
  'lib/extensions/loader.mjs',
  'lib/extensions/validate.mjs',
  'lib/extensions/manifests',
  'docs',
  'lib/registry/assemble.mjs',
];

function walkFiles(absPath) {
  let st;
  try { st = statSync(absPath); } catch { return null; }
  if (st.isFile()) return [absPath];
  if (!st.isDirectory()) return null;
  const out = [];
  const stack = [absPath];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  return out.sort();
}

/**
 * Hash a named group of seed paths (files and/or directories), recursing into
 * directories so an edit anywhere inside moves the hash. Missing paths hash
 * as a stable sentinel rather than throwing, so an optional seed (e.g. a
 * project override file that may not exist) does not abort hashing.
 *
 * @param {string} rootDir
 * @param {string[]} rels — repo-relative file or directory paths.
 * @returns {string} 16-hex-char digest.
 */
export function hashSourceGroup(rootDir, rels) {
  const h = createHash('sha256');
  for (const rel of rels) {
    const abs = path.join(rootDir, rel);
    const files = walkFiles(abs);
    if (!files) { h.update(`${rel}\0missing`); continue; }
    for (const filePath of files) {
      const relToRoot = path.relative(rootDir, filePath);
      h.update(relToRoot);
      try { h.update(readFileSync(filePath)); } catch { h.update('\0unreadable'); }
    }
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * Named seed-source groups making up the full graph seed set: registry
 * catalog + overlays, specialists/org, plugin (pack) directories, provider
 * manifests (builtin + user + project), and workflow manifests (builtin +
 * project; pack tiers are resolved per-pack root so are not enumerable here).
 *
 * @param {string} rootDir
 * @returns {Record<string,string[]>}
 */
export function sourceGroups(rootDir) {
  const manifestDirs = resolveManifestDirs({ rootDir });
  const workflowDirs = resolveWorkflowManifestDirs({ rootDir });

  return {
    registry: ['registry/capabilities.json', 'lib/registry/assemble.mjs', 'lib/registry/loader.mjs'],
    overlays: [
      path.join('.cx', 'org'),
      path.join('.cx', 'unified-registry.json'),
    ],
    specialistsOrg: ['specialists/org'],
    plugins: [path.join('.cx', 'packs'), 'lib/packs/manifests'],
    providerManifests: [
      manifestDirs.builtin,
      manifestDirs.user,
      manifestDirs.project,
      path.join('.cx', 'providers.json'),
    ].map((p) => path.isAbsolute(p) ? path.relative(rootDir, p) : p),
    workflowManifests: [
      workflowDirs.builtin,
      workflowDirs.project,
      'lib/embedded-contract/workflow-defs.mjs',
    ].map((p) => path.isAbsolute(p) ? path.relative(rootDir, p) : p),
  };
}

/**
 * @param {string} rootDir
 * @returns {Record<string,string>} hash per named source group.
 */
export function computeSourceHashes(rootDir) {
  const groups = sourceGroups(rootDir);
  const out = {};
  for (const [name, rels] of Object.entries(groups)) {
    out[name] = hashSourceGroup(rootDir, rels);
  }
  return out;
}

/**
 * @param {string} rootDir — project root holding .cx/graph/.
 * @returns {{
 *   present: boolean,
 *   stale: boolean,
 *   staleReason: string|null,
 *   staleSources: string[],
 *   currentHash?: string,
 *   storedHash?: string|null,
 * }}
 */
export function checkGraphStaleness(rootDir) {
  const graph = loadGraph(rootDir);
  if (!graph.exists) {
    return { present: false, stale: false, staleReason: null, staleSources: [] };
  }

  try {
    const current = hashFiles(rootDir, GRAPH_SEED_FILES);
    const stored = graph.meta?.sourceHash ?? null;

    const currentSources = computeSourceHashes(rootDir);
    const storedSources = graph.meta?.sourceHashes ?? null;
    const staleSources = [];
    if (storedSources) {
      for (const name of Object.keys(currentSources)) {
        if (currentSources[name] !== storedSources[name]) staleSources.push(name);
      }
    }

    const stale = staleSources.length > 0 || (stored != null && current !== stored && !storedSources);
    if (stale) {
      const reason = staleSources.length > 0
        ? `source(s) changed since last build: ${staleSources.join(', ')}`
        : 'registry/contracts/workflow seeds changed since last build';
      return {
        present: true,
        stale: true,
        staleReason: reason,
        staleSources,
        currentHash: current,
        storedHash: stored,
      };
    }
    return { present: true, stale: false, staleReason: null, staleSources: [], currentHash: current, storedHash: stored };
  } catch {
    return { present: true, stale: false, staleReason: null, staleSources: [] };
  }
}
