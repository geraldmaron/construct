/**
 * lib/prompt-layer-model.mjs — validated prompt-composer fragment precedence contract.
 *
 * Layer names match lib/prompt-composer.mjs assembly order (construct-72gqn.33).
 * Provenance and certification code import this module instead of duplicating order.
 */

export const PROMPT_LAYER_ORDER = Object.freeze([
  'core',
  'role-flavor',
  'model-profile',
  'task-context',
  'learned-patterns',
  'task-packet',
  'context-digest',
  'strategy',
  'host-constraints',
]);

const LAYER_INDEX = new Map(PROMPT_LAYER_ORDER.map((layer, index) => [layer, index]));

export function isPromptLayerName(layer) {
  return LAYER_INDEX.has(layer);
}

export function promptLayerIndex(layer) {
  if (!LAYER_INDEX.has(layer)) {
    throw new Error(`Unknown prompt layer: ${layer}`);
  }
  return LAYER_INDEX.get(layer);
}

export function sortFragmentsByLayer(fragments) {
  return [...fragments].sort((a, b) => promptLayerIndex(a.type) - promptLayerIndex(b.type));
}
