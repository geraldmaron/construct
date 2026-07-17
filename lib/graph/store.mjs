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
 * Persisted under `.construct/graph/` as deterministic JSONL so a graph round-trips
 * losslessly and diffs cleanly: nodes.jsonl (sorted by id), edges.jsonl
 * (sorted by from,rel,to), meta.json (generatedAt, sourceHash, counts).
 * Dependency-free and pure-JS per ADR-0001.
 *
 * `reads` (LMCP-E4): specialist --reads--> provider, seeded from pack
 * `embedBindings` grants (build-from-registry.mjs). Makes the embed
 * authority-guard's per-specialist read/search grant visible in
 * `construct graph`/`construct matrix` rather than living only in pack JSON.
 *
 * Per-target graphs (construct-1smc4.2): every read/write function accepts an
 * optional `targetId` that redirects the store to
 * `.cx/graph/targets/<targetId>/` instead of `.cx/graph/` — the same JSONL +
 * meta.json shape, the same atomic temp-then-rename write, just a sibling
 * directory per registered source target (lib/config/source-targets.mjs), so
 * a target's graph persists and round-trips exactly like the host graph and
 * survives a session restart the same way.
 *
 * Identity stability (construct-4uxq0.11.6): `renameNode` moves a node to a
 * new id without dropping history — it rewrites every edge that referenced
 * the old id, leaves a `tombstone`-type node at the old id
 * (`attrs.supersededBy: <newId>`), and stamps the old id onto the new node's
 * `attrs.aliases`. `dependenciesOf`/`dependentsOf` resolve a tombstone id
 * through `supersededBy` before indexing the adjacency maps, so a caller that
 * still queries the pre-rename id sees the live node's edges, not an empty
 * result. `writeGraph` also accepts `partial`/`partialReasons` so a caller
 * that collected fewer than all its seed sources (a builder threw partway
 * through `construct graph build`) can mark the persisted graph as such
 * instead of `meta.json` silently reporting a full build; `loadGraph`
 * defaults a pre-existing `meta.json` with no `partial` field to `false`
 * rather than requiring every prior graph to be rebuilt.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR_NAME } from '../config-dir.mjs';

export const NODE_TYPES = new Set([
  'file', 'module', 'workflow', 'capability', 'test', 'contract', 'surface', 'skill', 'rule',
  'provider', 'tool', 'pack', 'doc', 'specialist', 'runtime-evidence', 'embed', 'source', 'tombstone',
]);

export const EDGE_RELS = new Set([
  'imports', 'realizes', 'validates', 'covers', 'exposes', 'governed_by', 'uses', 'embeds', 'co_changes', 'contains',
  'requires', 'documents', 'evidenced_by', 'owned_by', 'reads', 'secures', 'derived_from',
]);

export const EDGE_SOURCES = new Set(['registry', 'import-graph', 'co-change', 'override', 'corpus-annotation', 'runtime-evidence', 'embed-manifest', 'source-link']);

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
 * List every targetId with a persisted graph under `.cx/graph/targets/`, so
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

// Canonical de-dup: nodes keyed by id (last write wins on attrs), edges keyed
// by from|rel|to (weights summed so repeated co-change observations accumulate).

function normalizeNodes(nodes) {
  const byId = new Map();
  for (const n of nodes) {
    if (!n?.id || !n?.type) continue;
    const prev = byId.get(n.id);
    byId.set(n.id, prev ? { ...prev, ...n, attrs: { ...(prev.attrs || {}), ...(n.attrs || {}) } } : { id: n.id, type: n.type, name: n.name ?? n.id, attrs: n.attrs || {} });
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function edgeKey(e) { return `${e.from}|${e.rel}|${e.to}`; }

function normalizeEdges(edges) {
  const byKey = new Map();
  for (const e of edges) {
    if (!e?.from || !e?.to || !e?.rel) continue;
    const key = edgeKey(e);
    const prev = byKey.get(key);
    if (prev) {
      prev.weight = (prev.weight || 1) + (e.weight || 1);
      if (e.source && !prev.sources.includes(e.source)) prev.sources.push(e.source);
      if (e.attrs) prev.attrs = { ...(prev.attrs || {}), ...e.attrs };
    } else {
      const normalized = { from: e.from, to: e.to, rel: e.rel, weight: e.weight || 1, sources: e.source ? [e.source] : (e.sources || []) };
      if (e.attrs) normalized.attrs = { ...e.attrs };
      byKey.set(key, normalized);
    }
  }
  return [...byKey.values()].sort((a, b) => (edgeKey(a) < edgeKey(b) ? -1 : 1));
}

function countBy(items, key) {
  const out = {};
  for (const it of items) { const k = it[key]; out[k] = (out[k] || 0) + 1; }
  return out;
}

/**
 * Persist a full graph (regenerate semantics). Nodes and edges are normalized
 * and sorted; meta records counts and the caller-supplied source hash.
 *
 * `sourceHashes` (LMCP-C6) is an optional `{ [sourceName]: hash }` map recording
 * a hash per seed source (registry, overlays, specialists/org, plugins,
 * provider manifests, workflow manifests) alongside the single combined
 * `sourceHash`, so staleness detection can name which source drifted instead
 * of only reporting "something changed".
 *
 * @param {string} rootDir
 * @param {{ nodes: object[], edges: object[], generatedAt?: string, sourceHash?: string, sourceHashes?: Record<string,string>, partial?: boolean, partialReasons?: string[] }} graph
 *   `partial`/`partialReasons` (construct-4uxq0.11.6): set when the caller
 *   collected fewer than all its seed sources (a builder threw partway
 *   through a `construct graph build` run) so the persisted graph records
 *   its own incompleteness instead of looking like a full build.
 * @param {{ targetId?: string|null }} [opts] — when set, writes to
 *   `.cx/graph/targets/<targetId>/` instead of `.cx/graph/`.
 * @returns {{ nodeCount: number, edgeCount: number, dir: string }}
 */
export function writeGraph(rootDir, { nodes = [], edges = [], generatedAt = null, sourceHash = null, sourceHashes = null, partial = false, partialReasons = [] } = {}, { targetId = null } = {}) {
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
    partialReasons: Array.isArray(partialReasons) ? partialReasons : [],
    nodeCount: normNodes.length,
    edgeCount: normEdges.length,
    nodesByType: countBy(normNodes, 'type'),
    edgesByRel: countBy(normEdges, 'rel'),
  };
  writeAtomic(metaPath(rootDir, targetId), JSON.stringify(meta, null, 2) + '\n');
  return { nodeCount: normNodes.length, edgeCount: normEdges.length, dir };
}

/**
 * Load the graph into an indexed, queryable view. Out/in adjacency maps make
 * forward (dependencies) and reverse (dependents) traversal O(degree).
 *
 * @param {string} rootDir
 * @param {{ targetId?: string|null }} [opts] — when set, loads
 *   `.cx/graph/targets/<targetId>/` instead of `.cx/graph/`.
 * @returns {{ nodes: Map<string,object>, edges: object[], out: Map<string,object[]>, in: Map<string,object[]>, meta: object|null, exists: boolean }}
 */
export function loadGraph(rootDir, { targetId = null } = {}) {
  const nodeList = readJsonl(nodesPath(rootDir, targetId));
  const edgeList = readJsonl(edgesPath(rootDir, targetId));
  let meta = null;
  try { meta = JSON.parse(readFileSync(metaPath(rootDir, targetId), 'utf8')); } catch { /* no meta */ }

  // A meta.json written before construct-4uxq0.11.6 has no `partial` field;
  // treat that as `false` rather than requiring every prior graph to be
  // rebuilt (see the file header's migration note).
  if (meta) {
    meta.partial = meta.partial === true;
    meta.partialReasons = Array.isArray(meta.partialReasons) ? meta.partialReasons : [];
  }

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

function filterRel(edges, rel) {
  if (!rel) return edges;
  const rels = Array.isArray(rel) ? new Set(rel) : new Set([rel]);
  return edges.filter((e) => rels.has(e.rel));
}

// A renamed node's old id resolves through its tombstone's `supersededBy`
// before either adjacency map is indexed, so a caller that still queries the
// pre-rename id reaches the live node's edges (renameNode rewrote every edge
// onto the new id) instead of an empty result. Cycle-guarded in case of a
// malformed chain, though renameNode never produces one.

function canonicalize(graph, id) {
  let current = id;
  const seen = new Set();
  while (true) {
    const node = graph.nodes.get(current);
    if (!node || node.type !== 'tombstone') return current;
    const next = node.attrs?.supersededBy;
    if (!next || seen.has(current)) return current;
    seen.add(current);
    current = next;
  }
}

/**
 * Nodes that `id` points to along `rel` (its dependencies).
 */
export function dependenciesOf(graph, id, rel = null) {
  return filterRel(graph.out.get(canonicalize(graph, id)) || [], rel).map((e) => e.to);
}

/**
 * Nodes that point to `id` along `rel` (its dependents).
 */
export function dependentsOf(graph, id, rel = null) {
  return filterRel(graph.in.get(canonicalize(graph, id)) || [], rel).map((e) => e.from);
}

export function nodesByType(graph, type) {
  return [...graph.nodes.values()].filter((n) => n.type === type);
}

/**
 * Move a node to a new id without dropping history: every edge that
 * referenced `oldId` is rewritten onto `newId`, `oldId` becomes a
 * `tombstone`-type node (`attrs.supersededBy: newId`) instead of
 * disappearing, and `newId` carries `oldId` (plus any prior aliases) in
 * `attrs.aliases` for direct visibility. Persists via `writeGraph`, so it
 * inherits the same atomic temp-then-rename write and preserves the prior
 * `sourceHash`/`sourceHashes`/`partial` meta fields rather than clobbering
 * them (a rename is a maintenance operation on an existing graph, not a
 * rebuild).
 *
 * @param {string} rootDir
 * @param {string} oldId
 * @param {string} newId
 * @param {{ targetId?: string|null }} [opts]
 * @returns {{ renamed: true, oldId: string, newId: string, tombstoneId: string }}
 */
export function renameNode(rootDir, oldId, newId, { targetId = null } = {}) {
  const graph = loadGraph(rootDir, { targetId });
  if (!graph.exists) throw new Error(`renameNode: no graph found at ${graphDir(rootDir, targetId)}`);
  const oldNode = graph.nodes.get(oldId);
  if (!oldNode) throw new Error(`renameNode: node not found: ${oldId}`);
  if (oldNode.type === 'tombstone') throw new Error(`renameNode: cannot rename a tombstone node: ${oldId}`);
  if (graph.nodes.has(newId)) throw new Error(`renameNode: target id already exists: ${newId}`);

  const priorAliases = Array.isArray(oldNode.attrs?.aliases) ? oldNode.attrs.aliases : [];
  const newNode = {
    ...oldNode,
    id: newId,
    attrs: { ...(oldNode.attrs || {}), aliases: [...new Set([...priorAliases, oldId])] },
  };
  const tombstoneNode = { id: oldId, type: 'tombstone', name: oldId, attrs: { supersededBy: newId } };

  const nodes = [...graph.nodes.values()].filter((n) => n.id !== oldId);
  nodes.push(newNode, tombstoneNode);

  const edges = graph.edges.map((e) => ({
    ...e,
    from: e.from === oldId ? newId : e.from,
    to: e.to === oldId ? newId : e.to,
  }));

  writeGraph(rootDir, {
    nodes,
    edges,
    generatedAt: graph.meta?.generatedAt ?? null,
    sourceHash: graph.meta?.sourceHash ?? null,
    sourceHashes: graph.meta?.sourceHashes ?? null,
    partial: graph.meta?.partial ?? false,
    partialReasons: graph.meta?.partialReasons ?? [],
  }, { targetId });

  return { renamed: true, oldId, newId, tombstoneId: oldId };
}
