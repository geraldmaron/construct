/**
 * lib/diagram-card.mjs — the Diagram Card contract (construct-tsyfe.4.1).
 *
 * Hand-rolled validator aligned with lib/contract-schemas/diagram-card.schema.json
 * (ADR-0001 — no Ajv), mirroring the lib/certification/run.mjs pattern: a plain
 * JS validator plus a parallel declarative schema, never a general JSON-Schema
 * engine. A Diagram Card is the canonical, graph-ingestable provenance record
 * for one rendered diagram (Mermaid, D2, dot, Cytoscape, semantic-HTML
 * wireframe, or any future provider) — what engine and version produced it,
 * what source it was rendered from, what security profile the renderer
 * honestly reports, and what accessibility description it carries.
 *
 * Construct-owned in this module: the schema, the validator, and the
 * graph-write helper. Provider-owned (downstream beads: mermaid hardening,
 * D2 provider consolidation, graphviz fallback review): actually populating
 * `engineVersion`/`seed`/`accessibilityDescription` correctly per engine, and
 * wiring lib/diagram.mjs, lib/diagram-export.mjs, lib/deck-export-pptx.mjs,
 * and packages/cx-ui/components/mermaid.tsx to call `buildDiagramCard`. No
 * caller is wired in this bead.
 *
 * Failure behavior: `buildDiagramCard` never throws and never silently omits
 * a required field. When a field can't be genuinely resolved (engine absent,
 * version unresolved, security profile or accessibility description not
 * supplied), the field is written explicitly `null`/a synthesized honest
 * placeholder, `degraded` is set `true`, and `reason` collects why — mirroring
 * the source-only degradation contract already documented in lib/diagram.mjs's
 * header comment.
 *
 * `accessibilityDescription` and `provenance.module`/`provenance.command` must
 * stay plain text (no markdown/HTML): they may later be surfaced in contexts
 * that don't expect renderable input, per this bead's Security & privacy note.
 * `source` is exempt — it is itself the diagram-definition language.
 */

import { nodeId, NODE_TYPES, EDGE_RELS } from './graph/store.mjs';

export const DIAGRAM_CARD_TYPE = 'diagram-card';
export const ENGINES = Object.freeze(['d2', 'dot', 'mermaid-source-only', 'unknown']);

// Neither engine has a resolvable executable version: 'mermaid-source-only' is
// a deliberate no-render choice (lib/diagram.mjs header), 'unknown' is the
// degraded absent/unreachable case (AC3) — both force engineVersion to null,
// but only 'unknown' counts as degraded on its own.

export const ENGINES_WITHOUT_VERSION = Object.freeze(['mermaid-source-only', 'unknown']);
const DEFAULT_GRAPH_EDGE_REL = 'evidenced_by';

// A tag or a markdown link/image target is proof the string is not plain
// text — reject rather than let it later render where only text is expected.

const MARKUP_PATTERN = /<[a-zA-Z!/][^>]*>|\]\([^)]*\)/;

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainText(value) {
  return hasText(value) && !MARKUP_PATTERN.test(value);
}

function isNullableString(value) {
  return value === null || typeof value === 'string';
}

export function validateDiagramCard(card) {
  const errors = [];
  if (!card || typeof card !== 'object') return { valid: false, errors: ['card is not an object'] };

  if (card.type !== DIAGRAM_CARD_TYPE) errors.push(`type must be '${DIAGRAM_CARD_TYPE}'`);
  if (!hasText(card.id)) errors.push('id required');
  if (!hasText(card.source)) errors.push('source required');

  if (!ENGINES.includes(card.engine)) errors.push(`engine invalid: ${card.engine}`);
  if (!isNullableString(card.engineVersion)) errors.push('engineVersion must be a string or null');
  if (ENGINES_WITHOUT_VERSION.includes(card.engine) && card.engineVersion !== null) {
    errors.push(`engineVersion must be null when engine is '${card.engine}'`);
  }

  if (!isNullableString(card.theme)) errors.push('theme must be a string or null');
  if (card.seed !== null && typeof card.seed !== 'string' && typeof card.seed !== 'number') {
    errors.push('seed must be a string, number, or null');
  }

  if (!hasText(card.securityProfile)) errors.push('securityProfile required');
  if (!isPlainText(card.accessibilityDescription)) errors.push('accessibilityDescription required (plain text, non-empty)');

  const provenance = card.provenance;
  if (!provenance || typeof provenance !== 'object') errors.push('provenance required');
  else {
    if (!hasText(provenance.module)) errors.push('provenance.module required');
    if (provenance.command != null && !isPlainText(provenance.command)) errors.push('provenance.command must be plain text when present');
    if (!hasText(provenance.generatedAt)) errors.push('provenance.generatedAt required');
  }

  if (typeof card.degraded !== 'boolean') errors.push('degraded must be a boolean');
  if (!isNullableString(card.reason)) errors.push('reason must be a string or null');
  if (card.degraded === true && !hasText(card.reason)) errors.push('reason required (non-empty) when degraded is true');
  if (card.degraded === false && card.reason !== null) errors.push('reason must be null when degraded is false');

  if (card.renderedOutput != null) {
    if (typeof card.renderedOutput !== 'object') errors.push('renderedOutput must be an object when present');
    else {
      const { path, sha256 } = card.renderedOutput;
      if (!isNullableString(path)) errors.push('renderedOutput.path must be a string or null');
      if (sha256 != null && !/^[a-f0-9]{64}$/.test(sha256)) errors.push('renderedOutput.sha256 must be a sha256 hex digest');
    }
  }

  return { valid: errors.length === 0, errors };
}

export function assertDiagramCard(card) {
  const result = validateDiagramCard(card);
  if (!result.valid) throw new Error(result.errors.join('; '));
  return card;
}

/**
 * Build a complete, always-valid-shape Diagram Card from whatever a caller
 * could resolve. Never throws: an unresolvable required field is recorded as
 * an honest `null`/placeholder plus `degraded: true` and a `reason`, never
 * dropped. Callers are the downstream renderer-wiring beads (not this one).
 */
export function buildDiagramCard({
  id,
  source,
  engine,
  engineVersion = null,
  theme = null,
  seed = null,
  securityProfile,
  accessibilityDescription,
  provenance = {},
  renderedOutput = null,
} = {}) {
  const reasons = [];
  let degraded = false;

  let resolvedEngine = engine;
  if (!ENGINES.includes(resolvedEngine)) {
    reasons.push(`engine '${engine ?? 'none'}' is absent or unreachable`);
    resolvedEngine = 'unknown';
    degraded = true;
  }

  let resolvedEngineVersion = engineVersion ?? null;
  if (ENGINES_WITHOUT_VERSION.includes(resolvedEngine)) {
    resolvedEngineVersion = null;
  } else if (resolvedEngineVersion === null) {
    reasons.push(`engineVersion unresolved for engine '${resolvedEngine}'`);
    degraded = true;
  }

  let resolvedSecurityProfile = securityProfile;
  if (!hasText(resolvedSecurityProfile)) {
    reasons.push('securityProfile not supplied by caller');
    resolvedSecurityProfile = 'unavailable';
    degraded = true;
  }

  let resolvedAccessibilityDescription = accessibilityDescription;
  if (!isPlainText(resolvedAccessibilityDescription)) {
    reasons.push('accessibilityDescription not supplied by caller');
    resolvedAccessibilityDescription = 'Accessibility description unavailable: not supplied at render time.';
    degraded = true;
  }

  const resolvedProvenance = {
    module: hasText(provenance.module) ? provenance.module : null,
    command: provenance.command ?? null,
    generatedAt: hasText(provenance.generatedAt) ? provenance.generatedAt : new Date().toISOString(),
  };
  if (!resolvedProvenance.module) {
    reasons.push('provenance.module not supplied by caller');
    resolvedProvenance.module = 'unknown';
    degraded = true;
  }

  return {
    type: DIAGRAM_CARD_TYPE,
    id: hasText(id) ? id : `diagram-card:${resolvedProvenance.generatedAt}`,
    source: hasText(source) ? source : '',
    engine: resolvedEngine,
    engineVersion: resolvedEngineVersion,
    theme,
    seed,
    securityProfile: resolvedSecurityProfile,
    accessibilityDescription: resolvedAccessibilityDescription,
    provenance: resolvedProvenance,
    degraded,
    reason: degraded ? reasons.join('; ') : null,
    renderedOutput,
  };
}

/**
 * Project a Diagram Card onto a `contract`-typed graph node (lib/graph/store.mjs
 * NODE_TYPES) plus an optional edge to the source file it documents, so
 * `construct graph` can query which diagrams exist and what produced them.
 * Returns the node/edge shape only — writing it into the on-disk store is a
 * downstream bead's responsibility (this bead does not wire a caller).
 */
export function diagramCardToGraphNode(card, { sourceFilePath = null, rel = DEFAULT_GRAPH_EDGE_REL } = {}) {
  const result = validateDiagramCard(card);
  if (!result.valid) throw new Error(`cannot graph a Diagram Card that fails validation: ${result.errors.join('; ')}`);
  if (!NODE_TYPES.has('contract')) throw new Error("lib/graph/store.mjs NODE_TYPES no longer includes 'contract'");
  if (!EDGE_RELS.has(rel)) throw new Error(`rel '${rel}' is not a known lib/graph/store.mjs EDGE_RELS entry`);

  const node = {
    id: nodeId('contract', card.id),
    type: 'contract',
    name: card.id,
    attrs: {
      contractKind: DIAGRAM_CARD_TYPE,
      engine: card.engine,
      engineVersion: card.engineVersion,
      securityProfile: card.securityProfile,
      degraded: card.degraded,
      provenance: card.provenance,
    },
  };

  const edges = sourceFilePath
    ? [{ from: node.id, to: nodeId('file', sourceFilePath), rel, source: 'diagram-card' }]
    : [];

  return { node, edges };
}
