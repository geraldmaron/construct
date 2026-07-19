/**
 * lib/graph/store.mjs — typed, directed dependency-graph store.
 *
 * The substrate for Construct's living dependency matrix. Nodes are typed
 * entities (file, module, workflow, capability, test, contract, surface,
 * skill, rule, provider, tool, pack, doc, specialist, runtime-evidence) addressed
 * by canonical ids of the form `type:key`. Edges are directed and carry a
 * relation kind (imports, realizes, validates, covers, exposes, governed_by,
 * uses, embeds, co_changes, contains, requires, documents, evidenced_by,
 * owned_by) and a provenance source
 * (registry, import-graph, co-change, override, corpus-annotation, runtime-evidence).
 *
 * Host graph (no `targetId`, construct-b0nny.3): writeGraph/loadGraph delegate
 * to the relational SQLite store (lib/graph/relational/) when `node:sqlite` is
 * available (Node >=22.5) — one graph.db under the machine-scoped state root,
 * replacing `.construct/graph/` JSONL as the source of truth. Every build also
 * refreshes a JSONL snapshot at the legacy path (lib/graph/relational/
 * export.mjs) for diff-clean review. On Node <22.5 (no node:sqlite,
 * e.g. the CI Node-20 leg) the host graph falls back to the JSONL
 * implementation below — the same resolver pattern lib/orchestration/store.mjs
 * already uses for its SQLite run store.
 *
 * Per-target graphs (construct-1smc4.2) are unaffected: every read/write
 * function accepts an optional `targetId` that redirects the store to
 * `.construct/graph/targets/<targetId>/` and always uses the JSONL implementation —
 * a target has no relational schema of its own and is out of scope for the
 * relational-store design (docs/notes/research/workspace-control-plane/
 * synthesis/graph-store-design.md).
 *
 * `reads` (LMCP-E4): specialist --reads--> provider, seeded from pack
 * `embedBindings` grants (build-from-registry.mjs). Makes the embed
 * authority-guard's per-specialist read/search grant visible in
 * `construct graph` rather than living only in pack JSON.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR_NAME } from '../config-dir.mjs';
import { normalizeNodes, normalizeEdges, countBy } from './normalize.mjs';
import { sqliteAvailable } from './relational/sqlite-db.mjs';
import * as relational from './relational/sqlite-store.mjs';
import { exportGraphSnapshot } from './relational/export.mjs';

export const NODE_TYPES = new Set([
  'file', 'module', 'workflow', 'capability', 'test', 'contract', 'surface', 'skill', 'rule',
  'provider', 'tool', 'pack', 'doc', 'specialist', 'runtime-evidence', 'embed',
]);

export const EDGE_RELS = new Set([
  'imports', 'realizes', 'validates', 'covers', 'exposes', 'governed_by', 'uses', 'embeds', 'co_changes', 'contains',
  'requires', 'documents', 'evidenced_by', 'owned_by', 'reads', 'secures',
]);

export const EDGE_SOURCES = new Set(['registry', 'import-graph', 'co-change', 'override', 'corpus-annotation', 'runtime-evidence', 'embed-manifest']);

const STORE_SUBDIR = path.join(CONFIG_DIR_NAME, 'graph');
const TARGETS_SUBDIR = 'targets';

export function graphDir(rootDir, targetId = null) {
  return targetId
    ? path.join(rootDir, STORE_SUBDIR, TARGETS_SUBDIR, targetId)
    : path.join(rootDir, STORE_SUBDIR);
}

export function nodeId(type, key) {
  return `${type}:${key}`;
}

function nodesPath(rootDir, targetId) { return path.join(graphDir(rootDir, targetId), 'nodes.jsonl'); }
function edgesPath(rootDir, targetId) { return path.join(graphDir(rootDir, targetId), 'edges.jsonl'); }
function metaPath(rootDir, targetId) { return path.join(graphDir(rootDir, targetId), 'meta.json'); }

/**
 * List every targetId with a persisted graph under `.construct/graph/targets/`, so
 * a `--projects=all` graph query knows which target stores to load without
 * re-resolving source targets from config.
 */
export function listTargetGraphIds(rootDir) {
  const dir = path.join(rootDir, STORE_SUBDIR, TARGETS_SUBDIR);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

function readJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  const out = [];
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed line */ }
  }
  return out;
}

function writeAtomic(filePath, contents) {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, contents, 'utf8');
  renameSync(tmp, filePath);
}

function writeGraphJsonl(rootDir, { nodes = [], edges = [], generatedAt = null, sourceHash = null, sourceHashes = null } = {}, targetId) {
  const dir = graphDir(rootDir, targetId);
  mkdirSync(dir, { recursive: true });
  const normNodes = normalizeNodes(nodes);
  const normEdges = normalizeEdges(edges);
  writeAtomic(nodesPath(rootDir, targetId), normNodes.map((n) => JSON.stringify(n)).join('\n') + (normNodes.length ? '\n' : ''));
  writeAtomic(edgesPath(rootDir, targetId), normEdges.map((e) => JSON.stringify(e)).join('\n') + (normEdges.length ? '\n' : ''));
  const meta = {
    schemaVersion: 1,
    generatedAt,
    sourceHash,
    sourceHashes: sourceHashes || null,
    nodeCount: normNodes.length,
    edgeCount: normEdges.length,
    nodesByType: countBy(normNodes, 'type'),
    edgesByRel: countBy(normEdges, 'rel'),
  };
  writeAtomic(metaPath(rootDir, targetId), JSON.stringify(meta, null, 2) + '\n');
  return { nodeCount: normNodes.length, edgeCount: normEdges.length, dir };
}

function loadGraphJsonl(rootDir, targetId) {
  const nodeList = readJsonl(nodesPath(rootDir, targetId));
  const edgeList = readJsonl(edgesPath(rootDir, targetId));
  let meta = null;
  try { meta = JSON.parse(readFileSync(metaPath(rootDir, targetId), 'utf8')); } catch { /* no meta */ }

  const nodes = new Map();
  for (const n of nodeList) nodes.set(n.id, n);
  const out = new Map();
  const inc = new Map();
  for (const e of edgeList) {
    if (!out.has(e.from)) out.set(e.from, []);
    if (!inc.has(e.to)) inc.set(e.to, []);
    out.get(e.from).push(e);
    inc.get(e.to).push(e);
  }
  return { nodes, edges: edgeList, out, in: inc, meta, exists: existsSync(nodesPath(rootDir, targetId)) };
}

/**
 * Persist a full graph (regenerate semantics): the host graph (no `targetId`)
 * writes through the relational SQLite store when available and refreshes the
 * legacy JSONL snapshot for diff-clean review; a target graph, or a host
 * graph on a runtime with no `node:sqlite`, writes JSONL directly (see the
 * module header for the resolver rule).
 *
 * `sourceHashes` (LMCP-C6) is an optional `{ [sourceName]: hash }` map recording
 * a hash per seed source (registry, overlays, registry, plugins,
 * provider manifests, workflow manifests) alongside the single combined
 * `sourceHash`, so staleness detection can name which source drifted instead
 * of only reporting "something changed".
 *
 * @param {string} rootDir
 * @param {{ nodes: object[], edges: object[], generatedAt?: string, sourceHash?: string, sourceHashes?: Record<string,string> }} graph
 * @param {{ targetId?: string|null }} [opts] — when set, writes to
 *   `.construct/graph/targets/<targetId>/` instead of `.construct/graph/`.
 * @returns {{ nodeCount: number, edgeCount: number, dir: string }}
 */
export function writeGraph(rootDir, graph = {}, { targetId = null } = {}) {
  if (targetId || !sqliteAvailable()) return writeGraphJsonl(rootDir, graph, targetId);
  const result = relational.writeGraph(rootDir, graph);
  exportGraphSnapshot(rootDir, relational.loadGraph(rootDir), graphDir(rootDir));
  return result;
}

/**
 * Load the graph into an indexed, queryable view. Out/in adjacency maps make
 * forward (dependencies) and reverse (dependents) traversal O(degree).
 *
 * @param {string} rootDir
 * @param {{ targetId?: string|null }} [opts] — when set, loads
 *   `.construct/graph/targets/<targetId>/` instead of `.construct/graph/`.
 * @returns {{ nodes: Map<string,object>, edges: object[], out: Map<string,object[]>, in: Map<string,object[]>, meta: object|null, exists: boolean }}
 */
export function loadGraph(rootDir, { targetId = null } = {}) {
  if (targetId || !sqliteAvailable()) return loadGraphJsonl(rootDir, targetId);
  return relational.loadGraph(rootDir);
}

function filterRel(edges, rel) {
  if (!rel) return edges;
  const rels = Array.isArray(rel) ? new Set(rel) : new Set([rel]);
  return edges.filter((e) => rels.has(e.rel));
}

/**
 * Nodes that `id` points to along `rel` (its dependencies).
 */
export function dependenciesOf(graph, id, rel = null) {
  return filterRel(graph.out.get(id) || [], rel).map((e) => e.to);
}

/**
 * Nodes that point to `id` along `rel` (its dependents).
 */
export function dependentsOf(graph, id, rel = null) {
  return filterRel(graph.in.get(id) || [], rel).map((e) => e.from);
}

export function nodesByType(graph, type) {
  return [...graph.nodes.values()].filter((n) => n.type === type);
}
