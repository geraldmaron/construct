/**
 * lib/graph/store.mjs — typed, directed dependency-graph store.
 *
 * The substrate for Construct's living dependency matrix. Nodes are typed
 * entities (file, module, workflow, capability, test, contract, surface,
 * skill, rule, provider, tool, pack, doc, worker-profile, runtime-evidence) addressed
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
 * `reads` (LMCP-E4): worker-profile --reads--> provider, seeded from pack
 * `embedBindings` grants (build-from-registry.mjs). Makes the embed
 * authority-guard's per-Worker Profile read/search grant visible in
 * `construct graph` rather than living only in pack JSON.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR_NAME } from '../config-dir.mjs';
import { normalizeNodes, normalizeEdges, countBy } from './normalize.mjs';
import { sqliteAvailable } from './relational/sqlite-db.mjs';
import * as relational from './relational/sqlite-store.mjs';
import { exportGraphSnapshot } from './relational/export.mjs';
import { archiveGraphBeforeWrite } from './history.mjs';

export const NODE_TYPES = new Set([
  'file', 'module', 'workflow', 'capability', 'test', 'contract', 'surface', 'skill', 'rule',
  'provider', 'tool', 'pack', 'doc', 'worker-profile', 'runtime-evidence', 'embed', 'card',
  'demo-manifest', 'tombstone', 'procedure', 'prompt-fragment', 'composed-prompt',
]);

export const EDGE_RELS = new Set([
  'imports', 'realizes', 'validates', 'covers', 'exposes', 'governed_by', 'uses', 'embeds', 'co_changes', 'contains',
  'requires', 'documents', 'evidenced_by', 'owned_by', 'reads', 'secures',
  'consumes_schema', 'couples_state', 'executes_write', 'merged_in', 'released_in', 'composes_into',
]);

export const EDGE_SOURCES = new Set(['registry', 'import-graph', 'co-change', 'override', 'corpus-annotation', 'runtime-evidence', 'embed-manifest', 'assurance-edges']);

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

function writeGraphJsonl(rootDir, {
  nodes = [],
  edges = [],
  generatedAt = null,
  sourceHash = null,
  sourceHashes = null,
  partial = false,
  partialReasons = null,
} = {}, targetId) {
  archiveGraphBeforeWrite(rootDir, { targetId });
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
    partial: partial === true,
    partialReasons: partial === true ? (partialReasons || []) : [],
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
  archiveGraphBeforeWrite(rootDir, { targetId: null });
  const result = relational.writeGraph(rootDir, graph);
  const loaded = relational.loadGraph(rootDir);
  loaded.meta = {
    ...(loaded.meta || {}),
    partial: graph.partial === true,
    partialReasons: graph.partial === true ? (graph.partialReasons || []) : [],
  };
  exportGraphSnapshot(rootDir, loaded, graphDir(rootDir));
  return result;
}

function mergeMetaOverlay(rootDir, graph, targetId) {
  if (!graph.exists) return graph;
  try {
    const overlay = JSON.parse(readFileSync(metaPath(rootDir, targetId), 'utf8'));
    graph.meta = { ...(graph.meta || {}), ...overlay };
  } catch {
    /* meta overlay optional */
  }
  return graph;
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
  const graph = (targetId || !sqliteAvailable())
    ? loadGraphJsonl(rootDir, targetId)
    : relational.loadGraph(rootDir);
  return mergeMetaOverlay(rootDir, graph, targetId);
}

function filterRel(edges, rel) {
  if (!rel) return edges;
  const rels = Array.isArray(rel) ? new Set(rel) : new Set([rel]);
  return edges.filter((e) => rels.has(e.rel));
}

function resolveNodeId(graph, id, seen = new Set()) {
  if (seen.has(id)) return id;
  seen.add(id);
  const node = graph.nodes.get(id);
  if (node?.type === 'tombstone' && node.attrs?.supersededBy) {
    return resolveNodeId(graph, node.attrs.supersededBy, seen);
  }
  return id;
}

/**
 * Nodes that `id` points to along `rel` (its dependencies).
 */
export function dependenciesOf(graph, id, rel = null) {
  const resolved = resolveNodeId(graph, id);
  return filterRel(graph.out.get(resolved) || [], rel).map((e) => e.to);
}

/**
 * Nodes that point to `id` along `rel` (its dependents).
 */
export function dependentsOf(graph, id, rel = null) {
  const resolved = resolveNodeId(graph, id);
  return filterRel(graph.in.get(resolved) || [], rel).map((e) => e.from);
}

/**
 * Rename a node in the JSONL graph: rewire edges, tombstone the old id, and
 * record the old id as an alias on the new node.
 */
export function renameNode(rootDir, oldId, newId, { targetId = null } = {}) {
  const graph = loadGraph(rootDir, { targetId });
  if (!graph.nodes.has(oldId)) throw new Error(`node not found: ${oldId}`);
  if (graph.nodes.has(newId) && newId !== oldId) throw new Error(`target id already exists: ${newId}`);

  const oldNode = graph.nodes.get(oldId);
  const priorAliases = oldNode.attrs?.aliases || [];
  const newNode = {
    ...oldNode,
    id: newId,
    attrs: {
      ...(oldNode.attrs || {}),
      aliases: [...new Set([...priorAliases, oldId])],
    },
  };
  const tombstone = {
    id: oldId,
    type: 'tombstone',
    name: oldId,
    attrs: { supersededBy: newId },
  };

  const nodes = [...graph.nodes.values()].filter((n) => n.id !== oldId);
  nodes.push(newNode, tombstone);

  const edges = graph.edges.map((e) => ({
    ...e,
    from: e.from === oldId ? newId : e.from,
    to: e.to === oldId ? newId : e.to,
  }));

  return writeGraph(rootDir, {
    nodes,
    edges,
    generatedAt: new Date().toISOString(),
    sourceHash: graph.meta?.sourceHash || null,
    sourceHashes: graph.meta?.sourceHashes || null,
  }, { targetId });
}

export function nodesByType(graph, type) {
  return [...graph.nodes.values()].filter((n) => n.type === type);
}
