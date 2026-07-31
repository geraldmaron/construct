/**
 * lib/graph/schema.mjs — schema-layer checks for the living graph.
 *
 * NODE_TYPES/EDGE_RELS (store.mjs) membership, required per-type attrs, and
 * edge provenance. Consumed by `construct graph verify`, `graph validate`,
 * and `graph build` (post-write). Accepts either a loadGraph-shaped graph
 * ({ nodes: Map, edges }) or an explicit `{ nodes, edges }` iterable pair.
 */

import { NODE_TYPES, EDGE_RELS } from './store.mjs';

const REQUIRED_NODE_ATTRS = {
  doc: ['path'],
  tombstone: ['supersededBy'],
};

function isBlank(value) {
  return value === undefined || value === null || value === '';
}

function edgeSources(edge) {
  if (Array.isArray(edge.sources) && edge.sources.length) return edge.sources;
  if (edge.source) return [edge.source];
  return [];
}

export function checkNodeSchema(node) {
  const errors = [];
  if (!node?.id) {
    errors.push('schema: node row missing id');
    return errors;
  }
  if (!node.type) {
    errors.push(`schema: node '${node.id}' missing type`);
    return errors;
  }
  if (!NODE_TYPES.has(node.type)) {
    errors.push(`node '${node.id}' has unknown type '${node.type}'`);
  }
  for (const attr of REQUIRED_NODE_ATTRS[node.type] || []) {
    if (isBlank(node.attrs?.[attr])) {
      errors.push(`node '${node.id}' (type '${node.type}') missing required attrs.${attr}`);
    }
  }
  return errors;
}

export function checkEdgeSchema(edge) {
  const errors = [];
  if (!edge?.from || !edge?.to || !edge?.rel) {
    errors.push('schema: edge row missing from/to/rel');
    return errors;
  }
  const label = `${edge.from}|${edge.rel}|${edge.to}`;
  if (!EDGE_RELS.has(edge.rel)) {
    errors.push(`edge '${label}' has unknown rel '${edge.rel}'`);
  }
  if (edgeSources(edge).length === 0) {
    errors.push(`edge '${label}' has no provenance (empty sources)`);
  }
  return errors;
}

/**
 * @param {{ exists?: boolean, nodes: Map|Iterable, edges: Iterable } | { nodes: Iterable, edges: Iterable }} input
 * @returns {{ errors: string[] }}
 */
export function validateSchema(input) {
  if (input && input.exists === false) {
    return { errors: ['no graph found — run construct graph build first'] };
  }
  const nodeIter = input?.nodes?.values
    ? input.nodes.values()
    : (input?.nodes || []);
  const edgeIter = input?.edges || [];
  const errors = [];
  for (const node of nodeIter) errors.push(...checkNodeSchema(node));
  for (const edge of edgeIter) errors.push(...checkEdgeSchema(edge));
  return { errors };
}
