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
 *
 * `checkExecutionStaleness` (LMCP-C9) is a second, independent staleness
 * dimension: source-hash staleness above asks "did the seeds change since
 * the graph was built"; execution staleness asks "has this workflow actually
 * run recently". A workflow can be source-fresh and execution-stale (nothing
 * changed, but no one has run it in months) or the reverse, so the two are
 * reported side by side rather than merged into one boolean. A workflow with
 * zero runtime-evidence ever (lib/graph/runtime-evidence.mjs) is flagged
 * `neverExecuted: true` distinctly from `stale: true` — the former is "no
 * evidence exists", the latter is "evidence exists but has aged past the
 * threshold" — so a caller never has to infer one from the absence of data
 * that could equally mean the other.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { hashFiles } from './build-from-registry.mjs';
import { loadGraph } from './store.mjs';
import { resolveManifestDirs } from '../extensions/loader.mjs';
import { resolveWorkflowManifestDirs } from '../workflows/loader.mjs';
import { computeLastExecutionByWorkflow } from './runtime-evidence.mjs';
import { listWorkflowDefs } from '../embedded-contract/workflow-defs.mjs';

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

/**
 * Default execution-staleness threshold: a workflow with runtime evidence
 * older than this many days is flagged stale. Overridable per-workflow via
 * the `thresholds` option (keyed by workflow type), so a high-churn workflow
 * can demand fresher evidence than a rarely-invoked one.
 */
export const EXECUTION_STALENESS_DEFAULT_THRESHOLD_DAYS = 30;

function ageDays(timestamp, now) {
  const then = Date.parse(timestamp);
  if (!Number.isFinite(then)) return null;
  return (now - then) / (1000 * 60 * 60 * 24);
}

/**
 * Per-workflow execution-staleness (LMCP-C9): how long since a workflow's
 * last runtime-evidence edge (lib/graph/runtime-evidence.mjs), against a
 * per-workflow threshold. A workflow with no evidence at all is reported
 * `neverExecuted: true` and `stale: false` — distinct from a workflow whose
 * evidence exists but has aged past the threshold (`stale: true`,
 * `neverExecuted: false`) — so the two conditions are never conflated.
 *
 * @param {string} rootDir — project root holding .cx/runtime/orchestration/runs/.
 * @param {{ thresholds?: Record<string,number>, now?: number }} [opts]
 * @returns {{
 *   workflows: Record<string, {
 *     lastExecution: { timestamp: string, outcome: string, runId: string }|null,
 *     neverExecuted: boolean,
 *     stale: boolean,
 *     ageDays: number|null,
 *     thresholdDays: number,
 *   }>,
 *   neverExecuted: string[],
 *   staleWorkflows: string[],
 * }}
 */
export function checkExecutionStaleness(rootDir, { thresholds = {}, now = Date.now() } = {}) {
  const lastExecutionByWorkflow = computeLastExecutionByWorkflow(rootDir);

  const workflows = {};
  const neverExecuted = [];
  const staleWorkflows = [];

  for (const wf of listWorkflowDefs()) {
    const lastExecution = lastExecutionByWorkflow[wf.type] ?? null;
    const thresholdDays = thresholds[wf.type] ?? EXECUTION_STALENESS_DEFAULT_THRESHOLD_DAYS;

    if (!lastExecution) {
      neverExecuted.push(wf.type);
      workflows[wf.type] = {
        lastExecution: null,
        neverExecuted: true,
        stale: false,
        ageDays: null,
        thresholdDays,
      };
      continue;
    }

    const age = ageDays(lastExecution.timestamp, now);
    const stale = age !== null && age > thresholdDays;
    if (stale) staleWorkflows.push(wf.type);

    workflows[wf.type] = {
      lastExecution,
      neverExecuted: false,
      stale,
      ageDays: age,
      thresholdDays,
    };
  }

  return {
    workflows,
    neverExecuted: neverExecuted.sort(),
    staleWorkflows: staleWorkflows.sort(),
  };
}
