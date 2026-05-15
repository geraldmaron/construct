/**
 * lib/task-graph/schema.mjs — task graph node + edge schema and validation.
 *
 * A task graph is the deterministic plan-of-work derived from an R&D
 * intake triage. Each node represents a unit of work owned by a persona;
 * edges encode ordering (depends_on, blocks, handoff_to), validation
 * (validates), and history (supersedes, derived_from).
 *
 * Node schema:
 *   {
 *     id, project, title, type, owner, status,
 *     dependsOn[], inputs[], outputs[], acceptanceCriteria[],
 *     evidence[], risk, createdAt, updatedAt
 *   }
 *
 * Status moves through: pending → claimed → in-progress → done | blocked |
 * needs-input | skipped. Evidence is appended as each verification step
 * produces output (see PR 8 worker sandbox).
 */

export const EDGE_TYPES = ['depends_on', 'blocks', 'handoff_to', 'validates', 'supersedes', 'derived_from'];

export const NODE_STATUSES = ['pending', 'claimed', 'in-progress', 'done', 'blocked', 'needs-input', 'skipped'];

export const NODE_TYPES = [
  'diagnosis',
  'implementation',
  'verification',
  'review',
  'research',
  'framing',
  'design',
  'hypothesis',
  'evaluation',
  'release',
  'runbook',
  'compliance-review',
];

export function isValidStatus(status) {
  return NODE_STATUSES.includes(status);
}

export function isValidEdgeType(type) {
  return EDGE_TYPES.includes(type);
}

const REQUIRED_NODE_FIELDS = ['id', 'project', 'title', 'type', 'owner', 'status'];

export function validateNode(node) {
  const errors = [];
  if (!node || typeof node !== 'object') {
    errors.push('node must be an object');
    return errors;
  }
  for (const field of REQUIRED_NODE_FIELDS) {
    if (!node[field]) errors.push(`missing required field: ${field}`);
  }
  if (node.status && !isValidStatus(node.status)) errors.push(`invalid status: ${node.status}`);
  if (node.dependsOn && !Array.isArray(node.dependsOn)) errors.push('dependsOn must be an array');
  return errors;
}

export function validateGraph(graph) {
  const errors = [];
  if (!graph?.id) errors.push('graph.id is required');
  if (!Array.isArray(graph?.nodes) || graph.nodes.length === 0) errors.push('graph.nodes must be a non-empty array');
  const ids = new Set();
  for (const node of graph?.nodes || []) {
    const nodeErrors = validateNode(node);
    for (const err of nodeErrors) errors.push(`node ${node?.id || '(unknown)'}: ${err}`);
    if (ids.has(node?.id)) errors.push(`duplicate node id: ${node.id}`);
    ids.add(node?.id);
  }
  for (const node of graph?.nodes || []) {
    for (const dep of node.dependsOn || []) {
      if (!ids.has(dep)) errors.push(`node ${node.id}: dependsOn references unknown node ${dep}`);
    }
  }
  return errors;
}
