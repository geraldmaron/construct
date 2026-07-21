/**
 * lib/mcp/tools/graph.tool.mjs — self-registered MCP read-only graph/impact tools.
 *
 * Exposes graph_query, graph_impacted, and graph_explain by calling the same
 * lib/graph/* helpers as `construct graph` (no CLI subprocess). Registered
 * through lib/mcp/tool-registry.mjs; reachable via the `call` long-tail gateway.
 */

import path from 'node:path';

import { queryGraphNode, queryGraphByType } from '../../graph/query-surface.mjs';
import { explainWorkflow } from '../../graph/explain-workflow.mjs';
import { computeImpacted } from '../../graph/impacted.mjs';

const READ_SAFETY = Object.freeze({
  class: 'read',
  filesystem: 'read',
  network: 'none',
  process: 'none',
});

function resolveProjectDir(args = {}, opts = {}) {
  if (args.root_dir) return path.resolve(String(args.root_dir));
  if (args.cwd) return path.resolve(String(args.cwd));
  return opts.cwd || process.cwd();
}

function normalizeChangedFiles(raw) {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
  return [];
}

export async function graphQuery(args = {}, opts = {}) {
  const projectDir = resolveProjectDir(args, opts);
  const nodeType = args.node_type ?? args.type;
  const nodeId = args.node_id ?? args.id;

  if (nodeType) {
    return queryGraphByType(projectDir, String(nodeType));
  }
  if (nodeId) {
    return queryGraphNode(projectDir, String(nodeId));
  }
  return { error: 'missing_target', message: 'Provide node_id or node_type' };
}

export async function graphImpacted(args = {}, opts = {}) {
  const projectDir = resolveProjectDir(args, opts);
  const changed = normalizeChangedFiles(args.changed_files ?? args.changed);
  if (changed.length === 0) {
    return { error: 'missing_changed_files', message: 'changed_files must be a non-empty array' };
  }
  const result = computeImpacted({ rootDir: projectDir, changedFiles: changed });
  if (!result.graphPresent) {
    return {
      graphPresent: false,
      error: 'no_graph',
      message: 'No graph found. Run `construct graph build` first.',
      changed: result.changed,
      unknown: result.unknown,
    };
  }
  return result;
}

export async function graphExplain(args = {}, opts = {}) {
  const projectDir = resolveProjectDir(args, opts);
  const procedureId = args.procedure_id ?? args.workflow_id ?? args.id;
  const payload = explainWorkflow(projectDir, procedureId);
  if (payload.error && !payload.result) return payload;
  if (payload.notFound) return payload;
  return payload.result;
}

export const TOOL_DEFS = [
  {
    name: 'graph_query',
    description:
      'Query the living dependency graph: lookup one node by id (dependencies and dependents) '
      + 'or list all nodes of a type. Read-only; matches `construct graph query --json`.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'Canonical graph node id (e.g. file:lib/foo.mjs).' },
        node_type: { type: 'string', description: 'List every node of this type (e.g. workflow, capability).' },
        root_dir: { type: 'string', description: 'Project root holding .construct/graph/ (defaults to cwd).' },
      },
    },
    safety: READ_SAFETY,
  },
  {
    name: 'graph_impacted',
    description:
      'Traverse from changed repo-relative files to impacted workflows, tests, docs, and capabilities. '
      + 'Read-only; matches `construct graph impacted --changed <files> --json`.',
    inputSchema: {
      type: 'object',
      required: ['changed_files'],
      properties: {
        changed_files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Repo-relative changed file paths.',
        },
        root_dir: { type: 'string', description: 'Project root holding .construct/graph/ (defaults to cwd).' },
      },
    },
    safety: READ_SAFETY,
  },
  {
    name: 'graph_explain',
    description:
      'Full ownership picture for one procedure/workflow: EDGE_RELS sections, roleChain, execution evidence. '
      + 'Read-only; matches `construct graph explain <id> --json`.',
    inputSchema: {
      type: 'object',
      required: ['procedure_id'],
      properties: {
        procedure_id: { type: 'string', description: 'Procedure or workflow id (bare or procedure: prefixed).' },
        root_dir: { type: 'string', description: 'Project root holding .construct/graph/ (defaults to cwd).' },
      },
    },
    safety: READ_SAFETY,
  },
];

export const TOOL_HANDLERS = {
  graph_query: graphQuery,
  graph_impacted: graphImpacted,
  graph_explain: graphExplain,
};
