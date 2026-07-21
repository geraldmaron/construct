/**
 * lib/graph/explain-workflow.mjs — workflow/procedure explain payload for CLI and MCP.
 *
 * Builds the same JSON object `construct graph explain --json` emits: one
 * section per EDGE_RELS member plus manifest roleChain, execution staleness,
 * and aggregated dependencies/providers/surfaces.
 */

import { loadGraph, dependenciesOf, dependentsOf, EDGE_RELS } from './store.mjs';
import {
  findDependencies,
  findProviders,
  findSurfaces,
  findMissingDocs,
} from './gap-queries.mjs';
import { checkExecutionStaleness } from './staleness.mjs';
import { loadAllProcedures } from '../procedures/loader.mjs';
import { checkProcedureLiveness } from '../procedures/liveness.mjs';

const WORKFLOW_LEVEL_RELS = new Set(['embeds', 'documents', 'uses', 'governed_by', 'requires', 'exposes', 'reads']);

function relLabel(rel) {
  return rel === 'requires' ? 'requires (via provider)' : rel;
}

function buildEdgeSections(graph, workflowId, projectDir) {
  const deps = findDependencies(projectDir).workflows[workflowId] || { contracts: [], uses: [], requires: [] };
  const surfaces = findSurfaces(projectDir).workflows[workflowId] || [];
  const docs = findMissingDocs(projectDir);
  const embeddingCaps = dependentsOf(graph, workflowId, 'embeds');
  const reads = new Set();
  for (const capId of embeddingCaps) {
    for (const providerId of dependenciesOf(graph, capId, 'uses').filter((i) => i.startsWith('provider:'))) {
      for (const specId of dependentsOf(graph, providerId, 'reads')) reads.add(specId);
    }
  }

  const values = {
    embeds: embeddingCaps,
    documents: dependentsOf(graph, workflowId, 'documents'),
    uses: deps.uses,
    governed_by: deps.contracts,
    requires: deps.requires,
    exposes: surfaces,
    reads: [...reads].sort(),
  };

  const sections = [];
  for (const rel of EDGE_RELS) {
    const applicable = WORKFLOW_LEVEL_RELS.has(rel);
    const links = applicable ? (values[rel] ?? []) : [];
    sections.push({
      rel,
      label: relLabel(rel),
      links,
      missing: applicable && links.length === 0,
      applicable,
    });
  }
  const documentsSection = sections.find((s) => s.rel === 'documents');
  if (documentsSection) documentsSection.missing = docs.workflows.includes(workflowId);

  return sections;
}

function buildRoleChainSection(workflowType, projectDir) {
  const { procedures } = loadAllProcedures({ rootDir: projectDir });
  const manifest = procedures.find((m) => m.id === workflowType);
  const { violations } = checkProcedureLiveness(procedures, { rootDir: projectDir });
  const ownViolations = violations.filter((v) => v.includes(`'${workflowType}'`) || (manifest?._filePath && v.startsWith(manifest._filePath)));
  const roleChain = Array.isArray(manifest?.roleChain) ? manifest.roleChain : [];
  return {
    rel: 'roleChain',
    label: 'roleChain',
    links: roleChain,
    missing: roleChain.length === 0,
    applicable: true,
    violations: ownViolations,
    provenance: manifest
      ? {
          source: manifest._source || 'unknown',
          filePath: manifest._filePath || null,
          shadows: manifest._shadowedBy || [],
        }
      : null,
  };
}

/**
 * @param {string} projectDir
 * @param {string} procedureId — bare id or procedure:/workflow: prefixed
 * @returns {{ graphPresent: boolean, error?: string, message?: string, notFound?: boolean, result?: object }}
 */
export function explainWorkflow(projectDir, procedureId) {
  const bareId = String(procedureId || '').replace(/^(procedure|workflow):/, '');
  if (!bareId) {
    return { graphPresent: false, error: 'missing_id', message: 'procedure_id is required' };
  }

  const procedureNodeId = `procedure:${bareId}`;
  const legacyWorkflowNodeId = `workflow:${bareId}`;

  const graph = loadGraph(projectDir);
  if (!graph.exists) {
    return { graphPresent: false, ...NO_GRAPH_PAYLOAD };
  }

  const nodeId = graph.nodes.has(procedureNodeId)
    ? procedureNodeId
    : graph.nodes.has(legacyWorkflowNodeId)
      ? legacyWorkflowNodeId
      : null;
  if (!nodeId) {
    return {
      graphPresent: true,
      notFound: true,
      error: 'not_found',
      message: `procedure not found in graph: ${procedureNodeId}`,
    };
  }

  const deps = findDependencies(projectDir).workflows[nodeId]
    || findDependencies(projectDir).workflows[procedureNodeId]
    || findDependencies(projectDir).workflows[legacyWorkflowNodeId]
    || { contracts: [], uses: [], requires: [] };
  const providers = findProviders(projectDir).workflows[nodeId]
    || findProviders(projectDir).workflows[procedureNodeId]
    || findProviders(projectDir).workflows[legacyWorkflowNodeId]
    || [];
  const surfaces = findSurfaces(projectDir).workflows[nodeId]
    || findSurfaces(projectDir).workflows[procedureNodeId]
    || findSurfaces(projectDir).workflows[legacyWorkflowNodeId]
    || [];
  const sections = buildEdgeSections(graph, nodeId, projectDir);
  const roleChainSection = buildRoleChainSection(bareId, projectDir);
  const allSections = [...sections, roleChainSection];

  const execution = checkExecutionStaleness(projectDir);
  const executionState = execution.workflows[bareId]
    || execution.procedures?.[bareId]
    || {
      lastExecution: null, neverExecuted: true, stale: false, ageDays: null, thresholdDays: null,
    };
  const node = graph.nodes.get(nodeId);

  return {
    graphPresent: true,
    result: {
      id: nodeId,
      node,
      dependencies: deps,
      providers,
      surfaces,
      sections: allSections,
      missing: allSections.filter((s) => s.missing).map((s) => s.rel),
      execution: executionState,
    },
  };
}

const NO_GRAPH_PAYLOAD = Object.freeze({
  error: 'no_graph',
  message: 'No graph found. Run `construct graph build` first.',
});
