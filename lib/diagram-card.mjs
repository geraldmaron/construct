/**
 * lib/diagram-card.mjs — Diagram Card contract (construct-tsyfe.4.1 / 4.4).
 *
 * Hand-rolled JSON-Schema-subset validation for per-diagram provenance: engine,
 * version, theme, security profile, accessibility text, and explicit degradation
 * when a compatibility fallback (Graphviz dot) renders instead of D2.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EDGE_RELS, NODE_TYPES, nodeId } from './graph/store.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = join(REPO_ROOT, 'lib', 'contract-schemas', 'diagram-card.schema.json');

const MARKUP_RE = /<|&(?:[a-z]+|#\d+);/i;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

let cachedSchema = null;

export function loadDiagramCardSchema({ schemaPath = SCHEMA_PATH } = {}) {
  if (cachedSchema && schemaPath === SCHEMA_PATH) return cachedSchema;
  const schema = readJson(schemaPath);
  if (schemaPath === SCHEMA_PATH) cachedSchema = schema;
  return schema;
}

function hasField(obj, field) {
  if (obj == null || typeof obj !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(obj, field)) return false;
  const value = obj[field];
  return value !== undefined && value !== null && value !== '';
}

function fieldAllowsNull(propSchema) {
  if (!propSchema) return false;
  if (propSchema.type === 'null') return true;
  return Array.isArray(propSchema.type) && propSchema.type.includes('null');
}

function collectSchemaShapeErrors(value, schema, pathLabel, errors) {
  if (!schema || typeof schema !== 'object') return;
  if (value === undefined || value === null) return;
  for (const field of schema.required || []) {
    const propSchema = schema.properties?.[field];
    const present = fieldAllowsNull(propSchema)
      ? Object.prototype.hasOwnProperty.call(value, field)
      : hasField(value, field);
    if (!present) errors.push(`${pathLabel} missing required field: ${field}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${pathLabel} value '${value}' not in allowed enum: ${schema.enum.join(', ')}`);
  }
  if (schema.properties && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in value) collectSchemaShapeErrors(value[key], propSchema, `${pathLabel}.${key}`, errors);
    }
  }
  if (schema.type === 'array' && schema.items && Array.isArray(value)) {
    value.forEach((item, i) => collectSchemaShapeErrors(item, schema.items, `${pathLabel}[${i}]`, errors));
  }
}

function assertPlainText(label, value, errors) {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${label} must be a non-empty plain-text string`);
    return;
  }
  if (MARKUP_RE.test(value)) errors.push(`${label} must not contain markup characters`);
}

export function validateDiagramCard(card, { schema = loadDiagramCardSchema() } = {}) {
  const errors = [];
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    return { ok: false, errors: ['diagram card must be an object'] };
  }
  const label = card.id ? `diagram card '${card.id}'` : 'diagram card';
  collectSchemaShapeErrors(card, schema, label, errors);
  assertPlainText(`${label}.accessibilityDescription`, card.accessibilityDescription, errors);
  assertPlainText(`${label}.provenance.command`, card.provenance?.command, errors);
  if (card.degraded === true && (!card.reason || !String(card.reason).trim())) {
    errors.push(`${label} must include a non-empty reason when degraded is true`);
  }
  if (card.degraded === false && card.reason != null && String(card.reason).trim()) {
    errors.push(`${label} must not include a reason when degraded is false`);
  }
  return { ok: errors.length === 0, errors };
}

export function assertDiagramCard(card, opts) {
  const result = validateDiagramCard(card, opts);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return card;
}

export function buildDiagramCard(input = {}) {
  const source = String(input.source || '').trim() || 'unknown';
  const card = {
    id: String(input.id || `diagram-${Date.now()}`),
    source,
    engine: input.engine || 'unknown',
    engineVersion: input.engineVersion ?? null,
    theme: input.theme ?? null,
    seed: input.seed ?? null,
    securityProfile: String(input.securityProfile || 'unknown'),
    accessibilityDescription: String(input.accessibilityDescription || '').trim(),
    provenance: {
      module: String(input.provenance?.module || 'lib/diagram.mjs'),
      command: String(input.provenance?.command || 'construct diagram'),
      generatedAt: String(input.provenance?.generatedAt || new Date().toISOString()),
    },
    degraded: Boolean(input.degraded),
    reason: input.degraded ? String(input.reason || 'degraded render path') : null,
  };
  if (input.renderedOutput?.path) {
    card.renderedOutput = {
      path: String(input.renderedOutput.path),
      ...(input.renderedOutput.sha256 ? { sha256: String(input.renderedOutput.sha256) } : {}),
    };
  }
  if (source === 'unknown') {
    card.degraded = true;
    card.reason = card.reason || 'diagram source path missing';
  }
  return card;
}

export function hashRenderedOutput(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  const bytes = readFileSync(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

export function writeDiagramCard(card, outPath) {
  const validated = assertDiagramCard(card);
  writeFileSync(outPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  return validated;
}

export function diagramCardToGraphNode(card, { sourceRel = null } = {}) {
  assertDiagramCard(card);
  if (!NODE_TYPES.has('contract')) throw new Error("graph store missing 'contract' node type");
  if (!EDGE_RELS.has('evidenced_by')) throw new Error("graph store missing 'evidenced_by' edge rel");

  const node = {
    id: nodeId('contract', card.id),
    type: 'contract',
    name: card.id,
    attrs: {
      engine: card.engine,
      degraded: card.degraded,
      reason: card.reason,
      securityProfile: card.securityProfile,
    },
  };
  const edges = [];
  if (sourceRel) {
    edges.push({
      from: node.id,
      to: nodeId('file', sourceRel),
      rel: 'evidenced_by',
      source: 'diagram-card',
    });
  }
  return { node, edges };
}

export { SCHEMA_PATH };
