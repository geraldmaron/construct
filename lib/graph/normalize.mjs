/**
 * lib/graph/normalize.mjs — canonical node/edge de-dup shared by every graph
 * backend.
 *
 * Shared by the JSONL backend (target graphs, lib/graph/build-target-graph.mjs)
 * and the relational backend (lib/graph/relational/) so both apply
 * byte-identical merge semantics: nodes keyed by id (last write wins on
 * attrs, shallow-merged), edges keyed by from|rel|to (weight summed, sources
 * unioned). One shared implementation keeps the relational store's
 * incremental per-row upsert (lib/graph/relational/sqlite-store.mjs) and its
 * full-rebuild path from diverging from each other or from the JSONL path.
 */

export function edgeKey(e) { return `${e.from}|${e.rel}|${e.to}`; }

export function normalizeNodes(nodes) {
  const byId = new Map();
  for (const n of nodes) {
    if (!n?.id || !n?.type) continue;
    const prev = byId.get(n.id);
    byId.set(n.id, prev ? { ...prev, ...n, attrs: { ...(prev.attrs || {}), ...(n.attrs || {}) } } : { id: n.id, type: n.type, name: n.name ?? n.id, attrs: n.attrs || {} });
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function normalizeEdges(edges) {
  const byKey = new Map();
  for (const e of edges) {
    if (!e?.from || !e?.to || !e?.rel) continue;
    const key = edgeKey(e);
    const prev = byKey.get(key);
    if (prev) {
      prev.weight = (prev.weight || 1) + (e.weight || 1);
      if (e.source && !prev.sources.includes(e.source)) prev.sources.push(e.source);
      for (const s of e.sources || []) if (!prev.sources.includes(s)) prev.sources.push(s);
    } else {
      byKey.set(key, { from: e.from, to: e.to, rel: e.rel, weight: e.weight || 1, sources: e.source ? [e.source] : (e.sources || []) });
    }
  }
  return [...byKey.values()].sort((a, b) => (edgeKey(a) < edgeKey(b) ? -1 : 1));
}

export function countBy(items, key) {
  const out = {};
  for (const it of items) { const k = it[key]; out[k] = (out[k] || 0) + 1; }
  return out;
}

export function mergeGraphSlices(...slices) {
  return {
    nodes: normalizeNodes(slices.flatMap((slice) => slice?.nodes || [])),
    edges: normalizeEdges(slices.flatMap((slice) => slice?.edges || [])),
  };
}

// Declared sources (directive §4: manifests, contracts, profiles, policies,
// schemas, migrations, work specs, plans, beads, ADRs) vs discovered/runtime-
// observed (import derivation, co-change, execution). An edge/node is
// `inferred` when every source that produced it is discovered or
// runtime-observed — mirrors the design doc §8.3 provenance mapping.

const DECLARED_SOURCES = new Set(['registry', 'override', 'corpus-annotation', 'embed-manifest']);

export function isInferredSources(sources) {
  const list = sources || [];
  if (list.length === 0) return false;
  return list.every((s) => !DECLARED_SOURCES.has(s));
}
