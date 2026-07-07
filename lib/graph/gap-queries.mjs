/**
 * lib/graph/gap-queries.mjs — read-only gap queries over the living graph (LMCP-C5).
 *
 * Six queries answer "what does this workflow/capability still need":
 * missing-docs (workflow/provider with zero inbound documents edges), stale
 * (per-source seed drift via lib/graph/staleness.mjs — LMCP-C6), dependencies
 * (per-workflow requires-edges: capability → provider/tool), providers
 * (per-workflow provider requirements via capability uses-edges to provider
 * nodes), and surfaces (per-workflow surface requirements via capability
 * exposes-edges). missing-tests lives in lib/graph/gaps.mjs and is re-exported
 * here for a single import surface; validateGraph (lib/graph/validate.mjs)
 * sources its own missing-tests warnings from the same findMissingTestCapabilities
 * function so `graph missing-tests` and `graph validate` never disagree.
 * Every query is read-only: it inspects the persisted store and never
 * mutates it.
 */

import { loadGraph, nodesByType, dependenciesOf, dependentsOf } from './store.mjs';
import { checkGraphStaleness } from './staleness.mjs';
import { findMissingTestCapabilities } from './gaps.mjs';

export { findMissingTestCapabilities as findMissingTests };

/**
 * Workflows and providers with zero inbound `documents` edges.
 *
 * @param {string} rootDir
 * @returns {{ graphPresent: boolean, workflows: string[], providers: string[] }}
 */
export function findMissingDocs(rootDir) {
  const graph = loadGraph(rootDir);
  if (!graph.exists) return { graphPresent: false, workflows: [], providers: [] };

  const workflows = nodesByType(graph, 'workflow')
    .filter((wf) => dependentsOf(graph, wf.id, 'documents').length === 0)
    .map((wf) => wf.id)
    .sort();

  const providers = nodesByType(graph, 'provider')
    .filter((p) => dependentsOf(graph, p.id, 'documents').length === 0)
    .map((p) => p.id)
    .sort();

  return { graphPresent: true, workflows, providers };
}

/**
 * Per-source seed-hash staleness (LMCP-C6): which named seed source(s), if
 * any, changed since the last `construct graph build`.
 *
 * @param {string} rootDir
 * @returns {{ graphPresent: boolean, stale: boolean, staleSources: string[], staleReason: string|null }}
 */
export function findStale(rootDir) {
  const state = checkGraphStaleness(rootDir);
  return {
    graphPresent: state.present,
    stale: state.stale,
    staleSources: state.staleSources || [],
    staleReason: state.staleReason,
  };
}

// A workflow's requirements are gathered via its embedding capabilities: a
// capability --embeds--> workflow edge is stored in the forward direction
// (capability -> workflow), so the workflow's capabilities are its
// dependents along 'embeds', not its dependencies.

function embeddingCapabilities(graph, workflowId) {
  return dependentsOf(graph, workflowId, 'embeds');
}

/**
 * Per-workflow declared dependencies: the union, over every capability that
 * embeds the workflow, of contracts (governed_by), skills/rules (uses), and
 * provider tool requirements (requires).
 *
 * @param {string} rootDir
 * @returns {{ graphPresent: boolean, workflows: Record<string, { contracts: string[], uses: string[], requires: string[] }> }}
 */
export function findDependencies(rootDir) {
  const graph = loadGraph(rootDir);
  if (!graph.exists) return { graphPresent: false, workflows: {} };

  const workflows = {};
  for (const wf of nodesByType(graph, 'workflow')) {
    const caps = embeddingCapabilities(graph, wf.id);
    const contracts = new Set();
    const uses = new Set();
    const requires = new Set();
    for (const capId of caps) {
      for (const id of dependenciesOf(graph, capId, 'governed_by')) contracts.add(id);
      for (const id of dependenciesOf(graph, capId, 'uses')) uses.add(id);
      for (const providerId of dependenciesOf(graph, capId, 'uses').filter((id) => id.startsWith('provider:'))) {
        for (const toolId of dependenciesOf(graph, providerId, 'requires')) requires.add(toolId);
      }
    }
    workflows[wf.id] = {
      contracts: [...contracts].sort(),
      uses: [...uses].sort(),
      requires: [...requires].sort(),
    };
  }

  return { graphPresent: true, workflows };
}

/**
 * Per-workflow provider requirements: providers named by any embedding
 * capability's `uses` edges.
 *
 * @param {string} rootDir
 * @returns {{ graphPresent: boolean, workflows: Record<string, string[]> }}
 */
export function findProviders(rootDir) {
  const graph = loadGraph(rootDir);
  if (!graph.exists) return { graphPresent: false, workflows: {} };

  const workflows = {};
  for (const wf of nodesByType(graph, 'workflow')) {
    const caps = embeddingCapabilities(graph, wf.id);
    const providers = new Set();
    for (const capId of caps) {
      for (const id of dependenciesOf(graph, capId, 'uses')) {
        if (id.startsWith('provider:')) providers.add(id);
      }
    }
    workflows[wf.id] = [...providers].sort();
  }

  return { graphPresent: true, workflows };
}

/**
 * Per-workflow surface requirements: surfaces exposed by any embedding
 * capability.
 *
 * @param {string} rootDir
 * @returns {{ graphPresent: boolean, workflows: Record<string, string[]> }}
 */
export function findSurfaces(rootDir) {
  const graph = loadGraph(rootDir);
  if (!graph.exists) return { graphPresent: false, workflows: {} };

  const workflows = {};
  for (const wf of nodesByType(graph, 'workflow')) {
    const caps = embeddingCapabilities(graph, wf.id);
    const surfaces = new Set();
    for (const capId of caps) {
      for (const id of dependenciesOf(graph, capId, 'exposes')) surfaces.add(id);
    }
    workflows[wf.id] = [...surfaces].sort();
  }

  return { graphPresent: true, workflows };
}
