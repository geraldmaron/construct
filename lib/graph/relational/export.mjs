/**
 * lib/graph/relational/export.mjs — JSONL snapshot + JSON/diagram export.
 *
 * exportGraphSnapshot refreshes the legacy `.construct/graph/{nodes,edges,
 * meta}` files from the relational store's current state on every build, so
 * the host graph stays diff-clean-reviewable in git history even though
 * SQLite is now the source of truth — the bead's "keep JSONL export
 * available for diff-clean review" acceptance criterion, and why existing
 * JSONL-reading consumers/tests keep working unchanged.
 *
 * exportGraphJson/exportGraphDiagram back `construct graph export` (directive
 * §4.8's `export` capability): a full JSON dump and a human-readable diagram
 * (mermaid or DOT) of the active edge set.
 */

import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

function writeAtomic(filePath, contents) {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, contents, 'utf8');
  renameSync(tmp, filePath);
}

function toLegacyNode(n) {
  return { id: n.id, type: n.type, name: n.name, attrs: n.attrs };
}

function toLegacyEdge(e) {
  const row = { from: e.from, to: e.to, rel: e.rel, weight: e.weight, sources: e.sources };
  if (e.attrs && Object.keys(e.attrs).length) row.attrs = e.attrs;
  return row;
}

function edgeSortKey(e) { return `${e.from}|${e.rel}|${e.to}`; }

/**
 * @param {string} rootDir
 * @param {ReturnType<import('./sqlite-store.mjs').loadGraph>} graph
 * @param {string} dir — destination directory (graphDir(rootDir)).
 */
export function exportGraphSnapshot(rootDir, graph, dir) {
  mkdirSync(dir, { recursive: true });
  const nodes = [...graph.nodes.values()].map(toLegacyNode).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const edges = graph.edges.map(toLegacyEdge).sort((a, b) => (edgeSortKey(a) < edgeSortKey(b) ? -1 : 1));
  writeAtomic(path.join(dir, 'nodes.jsonl'), nodes.map((n) => JSON.stringify(n)).join('\n') + (nodes.length ? '\n' : ''));
  writeAtomic(path.join(dir, 'edges.jsonl'), edges.map((e) => JSON.stringify(e)).join('\n') + (edges.length ? '\n' : ''));
  writeAtomic(path.join(dir, 'meta.json'), JSON.stringify(graph.meta, null, 2) + '\n');
  return { dir };
}

export function exportGraphJson(graph) {
  return {
    nodes: [...graph.nodes.values()],
    edges: graph.edges,
    meta: graph.meta,
  };
}

function sanitizeMermaidId(id) {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Human-readable diagram of the active edge set. Mermaid is the default
 * (renders inline in most markdown viewers); `format: 'dot'` emits Graphviz
 * for callers that already pipe through `dot`.
 */
export function exportGraphDiagram(graph, { format = 'mermaid' } = {}) {
  if (format === 'dot') {
    const lines = ['digraph construct_graph {'];
    for (const e of graph.edges) lines.push(`  "${e.from}" -> "${e.to}" [label="${e.rel}"];`);
    lines.push('}');
    return lines.join('\n') + '\n';
  }
  const lines = ['graph TD'];
  for (const e of graph.edges) {
    lines.push(`  ${sanitizeMermaidId(e.from)}["${e.from}"] -->|${e.rel}| ${sanitizeMermaidId(e.to)}["${e.to}"]`);
  }
  return lines.join('\n') + '\n';
}
