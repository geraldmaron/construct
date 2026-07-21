/**
 * lib/graph/incremental.mjs — scoped graph refresh on edit (construct-4uxq0.11.9).
 *
 * `updateGraphForFiles` maps changed repo-relative paths to staleness
 * SOURCE_GROUPS (lib/graph/staleness.mjs), re-runs only the builders whose
 * seeds cover those paths, merges the fresh slice with the live graph by
 * dropping prior rows from the same edge provenance and unioning the rebuild,
 * then applies the delta through the relational outbox when available (same
 * applier as `construct graph update`) or via a direct writeGraph merge on
 * JSONL-only runtimes. Failures and unmapped paths mark the graph stale through
 * meta freshness (`source_drift`) and checkGraphStaleness's freshness guard.
 */

import path from 'node:path';
import { packageRoot } from '../roots.mjs';
import { buildFromRegistry } from './build-from-registry.mjs';
import { buildFromCorpus } from './build-from-corpus.mjs';
import { buildImportGraph } from './build-import-graph.mjs';
import { buildCoChange } from './build-co-change.mjs';
import { buildRuntimeEvidence } from './runtime-evidence.mjs';
import { sourceGroups, computeSourceHashes, hashSourceGroup } from './staleness.mjs';
import { loadGraph, writeGraph, graphDir } from './store.mjs';
import { normalizeNodes, normalizeEdges, edgeKey, mergeGraphSlices } from './normalize.mjs';
import { sqliteAvailable, graphDbExists, withGraphDb } from './relational/sqlite-db.mjs';
import { enqueueOutboxEvent, drainOutbox } from './relational/outbox.mjs';
import { setFreshness, loadGraph as loadRelationalGraph } from './relational/sqlite-store.mjs';
import { exportGraphSnapshot } from './relational/export.mjs';
import { resolveGraphWorkspace } from './relational/workspace.mjs';

const REGISTRY_GROUPS = new Set(['registry', 'overlays', 'workerProfiles', 'plugins', 'providerManifests', 'workflowManifests']);
const REGISTRY_EDGE_SOURCES = ['registry'];
const IMPORT_EDGE_SOURCES = ['import-graph'];
const IMPORT_PATH_RE = /^(?:lib|bin|src|tests|scripts)\//;

/**
 * @param {string} projectDir — project root holding `.construct/` overlays.
 * @param {string} relPath — repo-relative path.
 * @returns {string[]} source group names whose seed paths cover relPath.
 */
export function resolveSourceGroupsForPath(projectDir, relPath) {
  const norm = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!norm) return [];
  const groups = sourceGroups(projectDir);
  const matched = [];
  for (const [name, rels] of Object.entries(groups)) {
    for (const rel of rels) {
      const prefix = String(rel).replace(/\\/g, '/');
      if (norm === prefix || norm.startsWith(`${prefix}/`)) {
        matched.push(name);
        break;
      }
    }
  }
  return matched;
}

/**
 * @param {string} projectDir
 * @param {string[]} changedFiles
 * @returns {string[]}
 */
export function resolveSourceGroupsForFiles(projectDir, changedFiles) {
  const out = new Set();
  for (const file of changedFiles || []) {
    for (const g of resolveSourceGroupsForPath(projectDir, file)) out.add(g);
  }
  return [...out].sort();
}

function needsImportGraphSlice(changedFiles) {
  return (changedFiles || []).some((f) => IMPORT_PATH_RE.test(String(f).replace(/\\/g, '/')));
}

function buildRegistrySlice({ rootDir }) {
  const reg = buildFromRegistry({ rootDir });
  return { nodes: reg.nodes, edges: reg.edges, edgeSources: REGISTRY_EDGE_SOURCES };
}

function buildImportSlice({ rootDir, projectDir, coChange }) {
  const reg = buildFromRegistry({ rootDir });
  const corpus = buildFromCorpus({ rootDir });
  const validates = [...reg.edges, ...corpus.edges].filter((e) => e.rel === 'validates');
  const impPkg = buildImportGraph({ rootDir, validates });
  const imp = path.resolve(projectDir) === path.resolve(rootDir)
    ? impPkg
    : mergeGraphSlices(impPkg, buildImportGraph({ rootDir: projectDir, validates }));
  const nodes = [...imp.nodes];
  const edges = [...imp.edges];
  if (coChange) {
    const sourceRels = imp.nodes.filter((n) => n.type === 'file' || n.type === 'test').map((n) => n.name);
    const co = buildCoChange({ rootDir, sourceRels });
    nodes.push(...co.nodes);
    edges.push(...co.edges);
  }
  return { nodes, edges, edgeSources: [...IMPORT_EDGE_SOURCES, 'co-change'] };
}

function buildSlice({ rootDir, projectDir, groups, changedFiles, coChange }) {
  const slices = [];
  if (groups.some((g) => REGISTRY_GROUPS.has(g))) slices.push(buildRegistrySlice({ rootDir }));
  if (needsImportGraphSlice(changedFiles)) slices.push(buildImportSlice({ rootDir, projectDir, coChange }));

  const evidence = buildRuntimeEvidence({ rootDir: projectDir, repoRoot: rootDir });
  const edgeSources = new Set(['runtime-evidence']);
  const nodes = [...evidence.nodes];
  const edges = [...evidence.edges];

  for (const slice of slices) {
    nodes.push(...slice.nodes);
    edges.push(...slice.edges);
    for (const src of slice.edgeSources) edgeSources.add(src);
  }

  return {
    nodes: normalizeNodes(nodes),
    edges: normalizeEdges(edges),
    edgeSources: [...edgeSources],
  };
}

function edgeSourcesOf(edge) {
  if (Array.isArray(edge.sources) && edge.sources.length) return edge.sources;
  return edge.source ? [edge.source] : [];
}

function edgeAffected(edge, affectedSources) {
  return edgeSourcesOf(edge).some((s) => affectedSources.has(s));
}

function mergeSlice(live, freshSlice, affectedEdgeSources) {
  const affected = new Set(affectedEdgeSources);
  const keptEdges = live.edges.filter((e) => !edgeAffected(e, affected));
  const mergedEdges = normalizeEdges([...keptEdges, ...freshSlice.edges]);
  const endpointIds = new Set();
  for (const e of mergedEdges) {
    endpointIds.add(e.from);
    endpointIds.add(e.to);
  }

  const freshById = new Map(freshSlice.nodes.map((n) => [n.id, n]));
  const nodesById = new Map();
  for (const n of live.nodes.values()) {
    if (freshById.has(n.id)) nodesById.set(n.id, freshById.get(n.id));
    else if (endpointIds.has(n.id)) nodesById.set(n.id, n);
  }
  for (const n of freshSlice.nodes) nodesById.set(n.id, n);

  return {
    nodes: normalizeNodes([...nodesById.values()]),
    edges: mergedEdges,
  };
}

function diffToOutboxEvents(live, merged, origin) {
  const events = [];
  const liveNodeMap = live.nodes;
  const mergedNodeMap = new Map(merged.nodes.map((n) => [n.id, n]));

  for (const id of liveNodeMap.keys()) {
    if (!mergedNodeMap.has(id)) {
      events.push({ eventType: 'node_delete', payload: { id }, origin });
    }
  }
  for (const [id, node] of mergedNodeMap) {
    const prev = liveNodeMap.get(id);
    const prevAttrs = JSON.stringify(prev?.attrs ?? {});
    const nextAttrs = JSON.stringify(node.attrs ?? {});
    if (!prev || prev.type !== node.type || prevAttrs !== nextAttrs) {
      events.push({ eventType: 'node_upsert', payload: node, origin });
    }
  }

  const liveEdgeMap = new Map(live.edges.map((e) => [edgeKey(e), e]));
  const mergedEdgeMap = new Map(merged.edges.map((e) => [edgeKey(e), e]));

  for (const [key, edge] of liveEdgeMap) {
    if (!mergedEdgeMap.has(key)) {
      events.push({ eventType: 'edge_delete', payload: { from: edge.from, to: edge.to, rel: edge.rel }, origin });
    }
  }
  for (const [key, edge] of mergedEdgeMap) {
    if (!liveEdgeMap.has(key)) {
      events.push({
        eventType: 'edge_upsert',
        payload: { from: edge.from, to: edge.to, rel: edge.rel, weight: edge.weight, sources: edge.sources },
        origin,
      });
    }
  }
  return events;
}

/**
 * @param {string} projectDir
 * @param {{ reason?: string }} [opts]
 */
export function markGraphSourceStale(projectDir, { reason = 'incremental update failed' } = {}) {
  if (sqliteAvailable() && graphDbExists(projectDir)) {
    withGraphDb(projectDir, (db) => {
      setFreshness(db, resolveGraphWorkspace(projectDir), 'source_drift');
    });
    const loaded = loadRelationalGraph(projectDir);
    exportGraphSnapshot(projectDir, loaded, graphDir(projectDir));
  }
  return { stale: true, reason };
}

function enqueueSourceHashUpdates(projectDir, origin) {
  for (const [name, hash] of Object.entries(computeSourceHashes(projectDir))) {
    enqueueOutboxEvent(projectDir, {
      eventType: 'source_rehash',
      payload: { sourceName: name, hash },
      origin,
    });
  }
}

function applyViaOutbox(projectDir, live, merged, { groups, origin, drain }) {
  const events = diffToOutboxEvents(live, merged, origin);
  for (const event of events) enqueueOutboxEvent(projectDir, event);
  enqueueSourceHashUpdates(projectDir, origin);
  const drainResult = drain ? drainOutbox(projectDir) : { applied: 0, failed: 0, deadLettered: 0, appliedIds: [] };
  return { events: events.length, drain: drainResult };
}

/**
 * @param {string} projectDir — active project root (.construct/graph lives here).
 * @param {string[]} changedFiles — repo-relative edited paths.
 * @param {{ rootDir?: string, coChange?: boolean, drain?: boolean, origin?: string }} [opts]
 */
export function updateGraphForFiles(projectDir, changedFiles, {
  rootDir = packageRoot,
  coChange = true,
  drain = true,
  origin = 'incremental',
} = {}) {
  const files = [...new Set((changedFiles || []).map((f) => String(f).replace(/\\/g, '/').replace(/^\/+/, '')))].filter(Boolean);
  if (!files.length) {
    return markGraphSourceStale(projectDir, { reason: 'no changed files' });
  }

  const groups = resolveSourceGroupsForFiles(projectDir, files);
  const importSlice = needsImportGraphSlice(files);
  if (!groups.length && !importSlice) {
    return markGraphSourceStale(projectDir, { reason: 'cannot map changed files to a graph source group' });
  }

  const live = loadGraph(projectDir);
  if (!live.exists) {
    return { ok: false, skipped: true, reason: 'no graph present' };
  }

  try {
    const freshSlice = buildSlice({ rootDir, projectDir, groups, changedFiles: files, coChange });
    const merged = mergeSlice(live, freshSlice, freshSlice.edgeSources);

    if (sqliteAvailable() && graphDbExists(projectDir)) {
      const applied = applyViaOutbox(projectDir, live, merged, { groups, origin, drain });
      return { ok: true, groups, importSlice, ...applied };
    }

    const sourceHashes = computeSourceHashes(projectDir);
    writeGraph(projectDir, {
      nodes: merged.nodes,
      edges: merged.edges,
      generatedAt: new Date().toISOString(),
      sourceHash: live.meta?.sourceHash ?? null,
      sourceHashes,
    });
    return { ok: true, groups, importSlice, events: 0, jsonl: true };
  } catch (err) {
    markGraphSourceStale(projectDir, { reason: err?.message || String(err) });
    return { ok: false, stale: true, error: err?.message || String(err) };
  }
}
