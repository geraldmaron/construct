/**
 * lib/graph/query-surface.mjs — read-only graph query helpers shared by CLI and MCP.
 *
 * Wraps loadGraph/store traversal for node lookup and type listing. Returns
 * structured objects (not stdout) so MCP tools and other in-process callers
 * get the same payload shape as `construct graph query --json`.
 */

import { loadGraph, dependenciesOf, dependentsOf, nodesByType } from './store.mjs';

export const NO_GRAPH = Object.freeze({
  error: 'no_graph',
  message: 'No graph found. Run `construct graph build` first.',
});

/**
 * @param {string} projectDir
 * @param {string} nodeId
 */
export function queryGraphNode(projectDir, nodeId) {
  const graph = loadGraph(projectDir);
  if (!graph.exists) return { ...NO_GRAPH, graphPresent: false };
  const node = graph.nodes.get(nodeId);
  return {
    id: nodeId,
    found: Boolean(node),
    node: node ?? null,
    dependencies: dependenciesOf(graph, nodeId),
    dependents: dependentsOf(graph, nodeId),
  };
}

/**
 * @param {string} projectDir
 * @param {string} nodeType
 */
export function queryGraphByType(projectDir, nodeType) {
  const graph = loadGraph(projectDir);
  if (!graph.exists) return { ...NO_GRAPH, graphPresent: false };
  const matches = nodesByType(graph, nodeType).map((node) => ({
    id: node.id,
    node,
    dependencies: dependenciesOf(graph, node.id),
    dependents: dependentsOf(graph, node.id),
  }));
  return {
    type: nodeType,
    count: matches.length,
    nodes: matches,
  };
}
