/**
 * lib/prompt-layer-contract.mjs — declared precedence contract for prompt-composer's fragment layers.
 *
 * Drop-priority tiers and cross-layer override semantics.
 * lib/prompt-composer.mjs imports PRIORITY from here. Fragment assembly order
 * lives in lib/prompt-layer-model.mjs and is re-exported below so callers can
 * validate order and priority from one import path. Module load runs
 * assertPromptLayerContract(): a malformed or incomplete contract throws
 * immediately, matching the fail-loud posture lib/mcp/server.mjs applies via
 * lib/mcp/tool-safety.mjs for a tool missing its safety classification.
 *
 * mayOverride / neverOverride declare instruction precedence, not assembly
 * position: mayOverride names layers whose capability or instruction claims
 * a given layer is permitted to restrict on conflict; neverOverride names
 * layers a given layer must always defer to on conflict. host-constraints
 * and the two never-drop layers (core, task-packet) carry the only
 * non-trivial entries — the layer contract resolved only those
 * cases; a future layer's override semantics require an explicit argued
 * entry here, not an empty placeholder array.
 *
 * validateFragmentOrder(fragmentTypes) checks a sequence of fragment `type`
 * strings — from a real composePrompt() call or a synthetic test double —
 * against PROMPT_LAYER_ORDER from prompt-layer-model.mjs.
 * tests/functional/prompt-layer-contract.functional.test.mjs drives both
 * cases.
 */

import { PROMPT_LAYER_ORDER } from './prompt-layer-model.mjs';

export { PROMPT_LAYER_ORDER };

// Priority tiers (1 = never drop, 5 = drop first). Single literal home for
// the map — prompt-composer.mjs imports rather than declaring its own.
export const PRIORITY = Object.freeze({
  'core': 1,
  'task-packet': 1,
  'role-flavor': 2,
  'model-profile': 2,
  'task-context': 2,
  'context-digest': 3,
  'strategy': 3,
  'learned-patterns': 4,
  'host-constraints': 5,
});

// Override semantics. host-constraints
// (priority 5, dropped first under budget pressure) may restrict a capability
// claim from any generated layer but must never restrict core or task-packet —
// a genuine conflict there is a caller bug to surface, not silently paper over.
// task-packet and core (priority 1, never-drop) may not be overridden by
// learned-patterns (priority 4). Layers with no entry below carry empty
// mayOverride/neverOverride — no rule has been argued for them yet.
const LAYER_MAY_OVERRIDE = Object.freeze({
  'core': Object.freeze(['learned-patterns']),
  'task-packet': Object.freeze(['learned-patterns']),
  'host-constraints': Object.freeze([
    'role-flavor',
    'model-profile',
    'task-context',
    'learned-patterns',
    'context-digest',
    'strategy',
  ]),
});

const LAYER_NEVER_OVERRIDE = Object.freeze({
  'role-flavor': Object.freeze(['core', 'task-packet']),
  'model-profile': Object.freeze(['core', 'task-packet']),
  'task-context': Object.freeze(['core', 'task-packet']),
  'learned-patterns': Object.freeze(['core', 'task-packet']),
  'context-digest': Object.freeze(['core', 'task-packet']),
  'strategy': Object.freeze(['core', 'task-packet']),
  'host-constraints': Object.freeze(['core', 'task-packet']),
});

export const PROMPT_LAYER_CONTRACT = Object.freeze(
  PROMPT_LAYER_ORDER.map((layer) => Object.freeze({
    layer,
    priority: PRIORITY[layer],
    mayOverride: LAYER_MAY_OVERRIDE[layer] || Object.freeze([]),
    neverOverride: LAYER_NEVER_OVERRIDE[layer] || Object.freeze([]),
  })),
);

/**
 * Merge workspaceType-derived role-flavor defaults with an explicit caller
 * override. Explicit entries always win over workspaceType-derived
 * defaults — the role-flavor-auto-selection precedence rule from
 * pinned here as executable code that
 * lib/prompt-composer.mjs's resolveRoleFlavors calls, rather than left as a
 * comment on that function alone.
 */
export function mergeRoleFlavorOverrides(explicitRoleFlavors, workspaceDefaults) {
  return { ...(workspaceDefaults || {}), ...(explicitRoleFlavors || {}) };
}

/**
 * Check a sequence of fragment `type` strings — from a real composePrompt()
 * call or a synthetic test double — against the declared PROMPT_LAYER_ORDER.
 * Returns { ok, reason }; reason is null on success, a diagnosis naming the
 * offending type and its predecessor otherwise. A subset of layers is
 * allowed — only present layers must appear in non-decreasing declared-order
 * position.
 */
export function validateFragmentOrder(fragmentTypes) {
  const indexOf = new Map(PROMPT_LAYER_ORDER.map((layer, i) => [layer, i]));
  let lastIndex = -1;
  let lastLayer = null;
  for (const type of fragmentTypes) {
    if (!indexOf.has(type)) {
      return { ok: false, reason: `fragment type "${type}" is not declared in PROMPT_LAYER_ORDER` };
    }
    const idx = indexOf.get(type);
    if (idx < lastIndex) {
      return { ok: false, reason: `fragment type "${type}" appears after "${lastLayer}", violating the declared order (${PROMPT_LAYER_ORDER.join(' → ')})` };
    }
    lastIndex = idx;
    lastLayer = type;
  }
  return { ok: true, reason: null };
}

function assertPromptLayerContract() {
  const seen = new Set();
  for (const layer of PROMPT_LAYER_ORDER) {
    if (seen.has(layer)) {
      throw new Error(`prompt-layer-contract: duplicate layer "${layer}" in PROMPT_LAYER_ORDER`);
    }
    seen.add(layer);
    if (!Number.isInteger(PRIORITY[layer]) || PRIORITY[layer] < 1 || PRIORITY[layer] > 5) {
      throw new Error(`prompt-layer-contract: layer "${layer}" has no valid PRIORITY entry (1-5)`);
    }
  }
  for (const key of Object.keys(PRIORITY)) {
    if (!seen.has(key)) {
      throw new Error(`prompt-layer-contract: PRIORITY declares layer "${key}" absent from PROMPT_LAYER_ORDER`);
    }
  }

  for (const record of PROMPT_LAYER_CONTRACT) {
    for (const target of [...record.mayOverride, ...record.neverOverride]) {
      if (!seen.has(target)) {
        throw new Error(`prompt-layer-contract: layer "${record.layer}" references unknown layer "${target}" in mayOverride/neverOverride`);
      }
      if (target === record.layer) {
        throw new Error(`prompt-layer-contract: layer "${record.layer}" cannot reference itself in mayOverride/neverOverride`);
      }
    }
  }

  const hostConstraints = PROMPT_LAYER_CONTRACT.find((r) => r.layer === 'host-constraints');
  if (!hostConstraints || hostConstraints.mayOverride.length === 0 || hostConstraints.neverOverride.length === 0) {
    throw new Error('prompt-layer-contract: host-constraints must declare non-empty mayOverride and neverOverride sets (see construct-72gqn.33 Decision)');
  }
}

assertPromptLayerContract();
