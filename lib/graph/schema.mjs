/**
 * lib/graph/schema.mjs — schema-layer checks for the living graph
 * (construct-4uxq0.11.6).
 *
 * NODE_TYPES/EDGE_RELS (store.mjs) were declared but never checked:
 * normalizeNodes/normalizeEdges only required an id/type or from/to/rel to be
 * present, not that `type`/`rel` be a member of either set, and nothing
 * checked that an edge carried provenance (`sources`) or that a type-specific
 * required attr (a `doc` node's `attrs.path`, a `tombstone` node's
 * `attrs.supersededBy`) was populated. `validateSchema` fills that gap as its
 * own layer, separate from validate.mjs's referential-integrity checks
 * (dangling targets, missing manifests/docs) so a caller can run schema
 * checks alone without paying for the full referential pass.
 *
 * Deliberately one-directional: this module reads NODE_TYPES/EDGE_RELS from
 * store.mjs but store.mjs does not import back from here, so writeGraph/
 * loadGraph stay free of a circular dependency. A caller that wants
 * write-time enforcement (e.g. `construct graph build` failing loud on a
 * newly-built graph) re-loads the just-written graph and runs
 * `validateSchema` itself — see lib/graph/cli.mjs's `runBuild`.
 */

import { NODE_TYPES, EDGE_RELS } from './store.mjs';

const REQUIRED_NODE_ATTRS = {
  doc: ['path'],
  tombstone: ['supersededBy'],
};

function isBlank(value) {
  return value === undefined || value === null || value === '';
}

export function checkNodeSchema(node) {
  const errors = [];
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
  const label = `${edge.from}|${edge.rel}|${edge.to}`;
  if (!EDGE_RELS.has(edge.rel)) {
    errors.push(`edge '${label}' has unknown rel '${edge.rel}'`);
  }
  if (!Array.isArray(edge.sources) || edge.sources.length === 0) {
    errors.push(`edge '${label}' has no provenance (empty sources)`);
  }
  return errors;
}

/**
 * @param {{ nodes: Iterable<object>, edges: Iterable<object> }} graph
 * @returns {string[]}
 */
export function validateSchema({ nodes, edges }) {
  const errors = [];
  for (const node of nodes) errors.push(...checkNodeSchema(node));
  for (const edge of edges) errors.push(...checkEdgeSchema(edge));
  return errors;
}
