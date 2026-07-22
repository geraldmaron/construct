/**
 * lib/graph/assurance-edges.mjs — Layer 2 assurance edge relation names (ADR-0091).
 *
 * Three change-aware coupling relations deferred from construct-4uxq0.12.4 to
 * construct-4uxq0.12.5 per the oracle-miss-report: schema consumers, shared
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
