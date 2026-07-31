/**
 * lib/graph/assurance-edges.mjs — Layer 2 assurance edge relation names.
 *
 * Three deferred change-aware coupling relations: schema consumers, shared
 * state writers/readers, and the governed-write execution chain.
 */

export const LAYER2_EDGE_RELS = Object.freeze([
  'consumes_schema',
  'couples_state',
  'executes_write',
]);

export const LAYER2_EDGE_SOURCE = 'assurance-edges';

export function isLayer2EdgeRel(rel) {
  return LAYER2_EDGE_RELS.includes(rel);
}
