/**
 * lib/graph/schema.mjs — strict node/edge schema checks for the living graph.
 *
 * Validates NODE_TYPES/EDGE_RELS membership, required per-type attrs, and edge
 * provenance (non-empty sources). Consumed by `construct graph verify` and
 * available to `graph validate` when strict enforcement is required.
 */

import { NODE_TYPES, EDGE_RELS } from './store.mjs';

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
    errors.push(`schema: node '${node.id}' has invalid type '${node.type}'`);
  }
  if (node.type === 'doc' && !node.attrs?.path) {
    errors.push(`schema: doc node '${node.id}' missing required attrs.path`);
  }
  if (node.type === 'tombstone' && !node.attrs?.supersededBy) {
    errors.push(`schema: tombstone node '${node.id}' missing required attrs.supersededBy`);
  }
  return errors;
}

export function checkEdgeSchema(edge) {
  const errors = [];
  if (!edge?.from || !edge?.to || !edge?.rel) {
    errors.push('schema: edge row missing from/to/rel');
    return errors;
  }
  if (!EDGE_RELS.has(edge.rel)) {
    errors.push(`schema: edge ${edge.from} --${edge.rel}--> ${edge.to} has invalid rel '${edge.rel}'`);
  }
  if (edgeSources(edge).length === 0) {
    errors.push(`schema: edge ${edge.from} --${edge.rel}--> ${edge.to} has empty provenance sources`);
  }
  return errors;
}

export function validateSchema(graph) {
  const errors = [];
  if (!graph?.exists) {
    return { errors: ['no graph found — run construct graph build first'] };
  }
  for (const node of graph.nodes.values()) {
    errors.push(...checkNodeSchema(node));
  }
  for (const edge of graph.edges) {
    errors.push(...checkEdgeSchema(edge));
  }
  return { errors };
}
