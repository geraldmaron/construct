/**
 * lib/chat/context-continuation.mjs — the deterministic context-continuation
 * contract (construct-6zga.1.9).
 *
 * A chat session's context is an ordered set of layers — static instructions,
 * role guidance, the task packet, validated evidence, tool results, the
 * conversation summary, optional learned patterns, plus the protected state
 * (user constraints, approvals, unresolved blockers). When context pressure
 * crosses the capability profile's compaction trigger (the execution policy's
 * continuation budget, never a model-name fixed limit), the session must compact
 * without silent loss: it produces a structured continuation packet that retains
 * required state verbatim, references reconstructible layers by source id for
 * re-derivation, elides compactible layers with a truthful marker, and — when the
 * required state alone exceeds the budget — yields a user-visible blocker instead
 * of dropping anything. The packet carries source ids and token accounting so a
 * reader can re-verify it, and rehydrateContinuation feeds the same layer set back
 * through the composer on every surface. Reference shape:
 * schemas/continuation-packet.schema.json.
 */

export const CONTINUATION_PACKET_SCHEMA_VERSION = 1;

export const CONTEXT_LAYER_KINDS = Object.freeze([
  'static-instructions',
  'role-guidance',
  'task-packet',
  'validated-evidence',
  'tool-results',
  'conversation-summary',
  'learned-patterns',
  'user-constraints',
  'approvals',
  'blockers',
]);

export const COMPACTION_ELIGIBILITY = Object.freeze(['required', 'reconstructible', 'compactible']);

export const LAYER_DISPOSITIONS = Object.freeze(['retained', 'referenced', 'elided']);

// The protected layers carry state the loop must never silently drop: user
// constraints, approvals, the current task packet, evidence provenance, and
// unresolved blockers. Reconstructible layers can be re-derived from a durable
// source by id, so the packet references rather than stores them. Compactible
// layers are conversation history that compacts lossily but is never silently
// lost — an elided one keeps a truthful marker of what was removed.

const DEFAULT_ELIGIBILITY = Object.freeze({
  'user-constraints': 'required',
  approvals: 'required',
  'task-packet': 'required',
  'validated-evidence': 'required',
  blockers: 'required',
  'static-instructions': 'reconstructible',
  'role-guidance': 'reconstructible',
  'learned-patterns': 'reconstructible',
  'conversation-summary': 'compactible',
  'tool-results': 'compactible',
});

function estimateTextTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function sumTokens(layers) {
  return layers.reduce((total, l) => total + (Number.isFinite(l.tokens) ? l.tokens : 0), 0);
}

/**
 * Normalize a raw layer set into a deterministic inventory: assign each layer an
 * id, a known kind, its compaction eligibility (explicit or kind-defaulted), and a
 * token count. Order is preserved so callers control retention priority.
 */
export function classifyContextLayers(layers = [], { estimateTokens = estimateTextTokens } = {}) {
  const list = Array.isArray(layers) ? layers : [];
  return list.map((raw, index) => {
    const kind = CONTEXT_LAYER_KINDS.includes(raw?.kind) ? raw.kind : 'conversation-summary';
    const eligibility = COMPACTION_ELIGIBILITY.includes(raw?.eligibility)
      ? raw.eligibility
      : (DEFAULT_ELIGIBILITY[kind] || 'compactible');
    const content = typeof raw?.content === 'string' ? raw.content : '';
    const tokens = Number.isFinite(raw?.tokens) ? raw.tokens : estimateTokens(content);
    return {
      id: raw?.id || `${kind}-${index}`,
      kind,
      eligibility,
      sourceId: raw?.sourceId ?? null,
      tokens,
      content,
    };
  });
}

function retainedLayer(layer) {
  return { id: layer.id, kind: layer.kind, eligibility: layer.eligibility, disposition: 'retained', tokens: layer.tokens, sourceId: layer.sourceId, content: layer.content };
}

function referencedLayer(layer) {
  return { id: layer.id, kind: layer.kind, eligibility: layer.eligibility, disposition: 'referenced', tokens: layer.tokens, sourceId: layer.sourceId, content: null };
}

function elidedLayer(layer) {
  return { id: layer.id, kind: layer.kind, eligibility: layer.eligibility, disposition: 'elided', tokens: layer.tokens, sourceId: layer.sourceId, content: null };
}

/**
 * Compact a classified inventory to the continuation budget. Required layers are
 * retained verbatim; a reconstructible layer with a source id is referenced for
 * re-derivation (and costs no budget), while one without a source id falls back to
 * the compactible pool so it is never lost. Compactible layers fill the remaining
 * budget in order and are elided with a marker once it is spent. When the required
 * state alone exceeds the budget the result is a truthful blocker — nothing is
 * dropped to make room for it.
 */
export function compactContext(inventory = [], { triggerTokens = null } = {}) {
  const layers = classifyContextLayers(inventory);
  const required = layers.filter((l) => l.eligibility === 'required');
  const reconstructible = layers.filter((l) => l.eligibility === 'reconstructible');
  const compactible = layers.filter((l) => l.eligibility === 'compactible');

  const requiredTokens = sumTokens(required);
  const budget = Number.isFinite(triggerTokens) && triggerTokens > 0 ? triggerTokens : Infinity;

  const referenced = [];
  const pressurePool = [...compactible];
  for (const layer of reconstructible) {
    if (layer.sourceId) referenced.push(referencedLayer(layer));
    else pressurePool.push(layer);
  }

  const blocked = requiredTokens > budget;
  const blocker = blocked
    ? { reason: 'required-state-exceeds-budget', requiredTokens, budgetTokens: budget, overflowTokens: requiredTokens - budget }
    : null;

  const retainedCompactible = [];
  const elided = [];
  let used = 0;
  const remaining = blocked ? 0 : budget - requiredTokens;
  for (const layer of pressurePool) {
    if (!blocked && used + layer.tokens <= remaining) {
      retainedCompactible.push(retainedLayer(layer));
      used += layer.tokens;
    } else {
      elided.push(elidedLayer(layer));
    }
  }

  const packetLayers = [
    ...required.map(retainedLayer),
    ...referenced,
    ...retainedCompactible,
    ...elided,
  ];

  return buildContinuationPacket({
    layers: packetLayers,
    requiredState: required.map((l) => ({ id: l.id, kind: l.kind, sourceId: l.sourceId, tokens: l.tokens })),
    budget,
    requiredTokens,
    blocker,
  });
}

/**
 * Assemble a structured, JSON-serializable continuation packet from a compaction
 * result. Token accounting balances the retained, referenced, and elided layers
 * against the budget so the packet is independently re-verifiable.
 */
export function buildContinuationPacket({ layers = [], requiredState = [], budget = Infinity, requiredTokens = 0, blocker = null } = {}) {
  const retainedTokens = sumTokens(layers.filter((l) => l.disposition === 'retained'));
  const elidedTokens = sumTokens(layers.filter((l) => l.disposition === 'elided'));
  const referencedCount = layers.filter((l) => l.disposition === 'referenced').length;

  return {
    schemaVersion: CONTINUATION_PACKET_SCHEMA_VERSION,
    budget: {
      triggerTokens: Number.isFinite(budget) ? budget : null,
      requiredTokens,
      retainedTokens,
      elidedTokens,
      referencedCount,
    },
    layers,
    requiredState,
    blocker,
  };
}

/**
 * Re-derive the ordered layer set a composer needs to resume a session. Required
 * and retained layers return their stored content; a referenced layer is re-derived
 * through resolveSource(sourceId) so reconstructible context returns intact; an
 * elided layer returns a truthful marker of what was removed. The same call backs
 * terminal, web, export, and resume — one rehydration path, no surface drift.
 */
export function rehydrateContinuation(packet, { resolveSource = null } = {}) {
  const layers = Array.isArray(packet?.layers) ? packet.layers : [];
  return layers.map((layer) => {
    if (layer.disposition === 'referenced') {
      const content = typeof resolveSource === 'function' ? resolveSource(layer.sourceId, layer) : null;
      return { id: layer.id, kind: layer.kind, content: typeof content === 'string' ? content : null, resolved: typeof content === 'string', sourceId: layer.sourceId };
    }
    if (layer.disposition === 'elided') {
      return { id: layer.id, kind: layer.kind, content: null, elided: true, tokens: layer.tokens, sourceId: layer.sourceId };
    }
    return { id: layer.id, kind: layer.kind, content: layer.content ?? '' };
  });
}

/**
 * Read the continuation budget from a compiled execution policy
 * (lib/models/execution-policy.mjs). Capability-profile driven, never a model-name
 * fixed limit (construct-6zga.1.2 AC4).
 */
export function continuationBudgetFromPolicy(policy) {
  const c = policy && typeof policy === 'object' ? policy.continuation : null;
  return {
    triggerTokens: Number.isFinite(c?.compactionTriggerTokens) ? c.compactionTriggerTokens : null,
    triggerRatio: Number.isFinite(c?.compactionTriggerRatio) ? c.compactionTriggerRatio : null,
  };
}

/**
 * Hand-rolled validator (no ajv — Construct stays dependency-free at startup).
 * Beyond shape, it enforces the no-silent-loss invariant: every required layer is
 * retained unless the packet carries a blocker.
 */
export function validateContinuationPacket(packet) {
  const errors = [];
  if (!packet || typeof packet !== 'object') return { valid: false, errors: ['packet is not an object'] };
  if (packet.schemaVersion !== CONTINUATION_PACKET_SCHEMA_VERSION) errors.push(`schemaVersion must be ${CONTINUATION_PACKET_SCHEMA_VERSION}`);

  if (!Array.isArray(packet.layers)) errors.push('layers must be an array');
  else {
    for (const layer of packet.layers) {
      if (!CONTEXT_LAYER_KINDS.includes(layer?.kind)) errors.push(`layer.kind invalid: ${layer?.kind}`);
      if (!COMPACTION_ELIGIBILITY.includes(layer?.eligibility)) errors.push(`layer.eligibility invalid: ${layer?.eligibility}`);
      if (!LAYER_DISPOSITIONS.includes(layer?.disposition)) errors.push(`layer.disposition invalid: ${layer?.disposition}`);
    }
  }

  if (!Array.isArray(packet.requiredState)) errors.push('requiredState must be an array');
  if (!packet.budget || typeof packet.budget !== 'object') errors.push('budget missing');
  else if (!Number.isInteger(packet.budget.requiredTokens) || packet.budget.requiredTokens < 0) errors.push('budget.requiredTokens invalid');

  const hasBlocker = packet.blocker && typeof packet.blocker === 'object';
  if (Array.isArray(packet.layers) && !hasBlocker) {
    const droppedRequired = packet.layers.find((l) => l?.eligibility === 'required' && l?.disposition !== 'retained');
    if (droppedRequired) errors.push(`required layer not retained without a blocker: ${droppedRequired.id}`);
  }

  return { valid: errors.length === 0, errors };
}
