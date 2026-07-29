/**
 * lib/graph/gaps.mjs — coverage-gap queries over the living dependency graph.
 *
 * findMissingTestCapabilities() answers "which capabilities/workflows have
 * zero validating tests" by reading the persisted graph's inbound validates
 * edges — the C1 store already dedups test --validates--> capability edges
 * from both registry (verification.functional/hostEmulation) and
 * corpus-annotation (@capability tags) sources, so a zero-count here is a
 * real gap, not a source-coverage artifact. A workflow is flagged only when
 * every capability that embeds it also has zero validating tests, since a
 * partially-tested workflow is a weaker signal than an untested capability.
 */

import { loadGraph, nodesByType, dependentsOf, dependenciesOf } from './store.mjs';

/**
 * @param {string} rootDir
 * @returns {{ graphPresent: boolean, capabilities: string[], workflows: string[] }}
 */
export function findMissingTestCapabilities(rootDir) {
  const graph = loadGraph(rootDir);
  if (!graph.exists) return { graphPresent: false, capabilities: [], workflows: [] };

  const untestedCapIds = new Set();
  for (const cap of nodesByType(graph, 'capability')) {
    if (dependentsOf(graph, cap.id, 'validates').length === 0) untestedCapIds.add(cap.id);
  }

  const untestedWorkflows = [];
  for (const wf of nodesByType(graph, 'procedure')) {
    const embeddingCaps = dependentsOf(graph, wf.id, 'embeds');
    if (embeddingCaps.length === 0) continue;
    if (embeddingCaps.every((capId) => untestedCapIds.has(capId))) untestedWorkflows.push(wf.id);
  }

  return {
    graphPresent: true,
    capabilities: [...untestedCapIds].sort(),
    workflows: untestedWorkflows.sort(),
  };
}
