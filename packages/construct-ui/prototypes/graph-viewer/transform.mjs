/**
 * packages/construct-ui/prototypes/graph-viewer/transform.mjs — lib/graph/store.mjs
 * JSONL to Cytoscape.js elements (construct-tsyfe.4.5 prototype).
 *
 * PROTOTYPE ONLY — not wired into any production route/command/build.
 *
 * Pure, dependency-free transform (no cytoscape import here) so it stays
 * testable and reusable from both the Node smoke test and the browser demo
 * entry point. A node/edge only appears in a view when BOTH its own type/rel
 * qualifies AND (for edges) both endpoints are in that same view's node set —
 * a cross-view edge (e.g. a `realizes` edge from a `file` to a `capability`)
 * is dropped from both views rather than rendered dangling. This is a known
 * simplification of the prototype, not a claim that cross-view edges don't
 * exist (see DECISION.md).
 */

export function parseJsonl(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function filterView(nodes, edges, view) {
  const viewNodes = nodes.filter((n) => view.nodeTypes.has(n.type));
  const viewIds = new Set(viewNodes.map((n) => n.id));
  const viewEdges = edges.filter((e) => view.edgeRels.has(e.rel) && viewIds.has(e.from) && viewIds.has(e.to));
  return { nodes: viewNodes, edges: viewEdges };
}

/**
 * Cytoscape.js elements format: `{ nodes: [{data}], edges: [{data}] }`, per
 * https://js.cytoscape.org/#notation/elements-json (no eval, no remote fetch —
 * plain data objects only).
 */
export function toCytoscapeElements(nodes, edges) {
  return {
    nodes: nodes.map((n) => ({ data: { id: n.id, label: n.name ?? n.id, type: n.type } })),
    edges: edges.map((e, i) => ({ data: { id: `e${i}:${e.from}->${e.to}:${e.rel}`, source: e.from, target: e.to, rel: e.rel } })),
  };
}

export function buildViewElements(nodes, edges, view) {
  const { nodes: viewNodes, edges: viewEdges } = filterView(nodes, edges, view);
  return toCytoscapeElements(viewNodes, viewEdges);
}
