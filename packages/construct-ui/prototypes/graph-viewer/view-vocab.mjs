/**
 * packages/construct-ui/prototypes/graph-viewer/view-vocab.mjs — view split for the
 * Cytoscape.js prototype (construct-tsyfe.4.5).
 *
 * PROTOTYPE ONLY — not wired into any production route/command/build. See
 * packages/construct-ui/prototypes/graph-viewer/README.md for scope and disposition.
 *
 * Splits lib/graph/store.mjs's single typed graph into the two views the bead
 * asks for: an "application" graph (capability/contract/skill/rule/provider/
 * specialist/... — the non-file entities) and a "dependency" graph (file/module
 * + their structural edges). Browser-loadable on its own (no `node:fs`
 * import) — entry.mjs runs client-side and lib/graph/store.mjs pulls in Node
 * built-ins, so the vocabulary is duplicated here rather than imported.
 * tests/graph/cytoscape-graph-viewer-prototype.test.mjs cross-checks these
 * constants against the live NODE_TYPES/EDGE_RELS so drift surfaces in
 * `node --test` instead of silently misclassifying a new type.
 */

export const DEPENDENCY_NODE_TYPES = new Set(['file', 'module']);
export const DEPENDENCY_EDGE_RELS = new Set(['imports', 'contains', 'co_changes']);

// lib/graph/store.mjs NODE_TYPES/EDGE_RELS as of this prototype's authoring —
// application view is "everything not in DEPENDENCY_*", listed explicitly (not
// derived by set-difference from an import) so the browser bundle stays free
// of lib/graph/store.mjs's `node:fs` dependency.

export const APPLICATION_NODE_TYPES = new Set([
  'capability', 'card', 'composed-prompt', 'contract', 'demo-manifest', 'doc', 'embed', 'pack', 'source',
  'procedure', 'prompt-fragment', 'provider', 'rule', 'runtime-evidence', 'skill', 'surface', 'test',
  'tombstone', 'tool', 'worker-profile', 'workflow',
]);
export const APPLICATION_EDGE_RELS = new Set([
  'composes_into', 'consumes_schema', 'couples_state', 'covers', 'derived_from', 'documents', 'embeds', 'evidenced_by',
  'executes_write', 'exposes', 'governed_by', 'merged_in', 'owned_by', 'reads', 'realizes', 'released_in',
  'requires', 'secures', 'uses', 'validates',
]);

export const VIEWS = Object.freeze({
  application: { nodeTypes: APPLICATION_NODE_TYPES, edgeRels: APPLICATION_EDGE_RELS },
  dependency: { nodeTypes: DEPENDENCY_NODE_TYPES, edgeRels: DEPENDENCY_EDGE_RELS },
});
