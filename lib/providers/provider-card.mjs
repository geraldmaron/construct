/**
 * lib/providers/provider-card.mjs — loader/validator for schemas/provider-card.schema.json (construct-4uxq0.13.7).
 *
 * A Provider Card is the single-artifact-per-provider record of identity,
 * version policy, health check, and fallback behavior for anything Construct
 * depends on to run. This module is the reconciliation point for four prior
 * scattered sources — deps/intent.json, registry/capabilities.json,
 * lib/ingest/sidecar-providers.mjs's ingestion-provider manifests, and
 * lib/providers/instance-config.mjs — see schemas/provider-card.schema.json's
 * own `description` for the per-source mapping.
 *
 * Follows the hand-rolled JSON-Schema-subset validator pattern established by
 * lib/contracts/validate.mjs's collectSchemaShapeErrors (no new validation
 * library, per the bead's decision — zero-npm-core compliant, no ADR-0001
 * dependency). Extended here to resolve `$ref: '#/$defs/...'` pointers, since
 * the Provider Card schema factors versionPolicy/healthCheck/fallback/
 * fallbackChainStep into `$defs` rather than inlining them.
 *
 * Surfaces:
 *   - scripts/validate-provider-cards.mjs invokes validateProviderCardRegistry
 *     at the on-disk registry (registry/provider-cards.json), mirroring
 *     scripts/validate-dep-intent.mjs's exit-code contract.
 *   - Sibling beads (construct-4uxq0.13.12, construct-tsyfe.4.3/.5.3/.6.5/.6.7,
 *     construct-tsyfe.10.3) read cards via loadProviderCards/findProviderCard.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA_PATH = join(REPO_ROOT, 'schemas', 'provider-card.schema.json');
const DEFAULT_REGISTRY_PATH = join(REPO_ROOT, 'registry', 'provider-cards.json');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

let cachedSchema = null;

/**
 * Load the Provider Card JSON Schema. Cached for the default path only —
 * tests that pass an explicit schemaPath (e.g. a malformed-fixture schema)
 * always re-read from disk.
 */
export function loadProviderCardSchema({ schemaPath = SCHEMA_PATH } = {}) {
  if (cachedSchema && schemaPath === SCHEMA_PATH) return cachedSchema;
  const schema = readJson(schemaPath);
  if (schemaPath === SCHEMA_PATH) cachedSchema = schema;
  return schema;
}

function resolveRef(ref, rootSchema) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/');
  let node = rootSchema;
  for (const part of parts) {
    node = node?.[part];
    if (node === undefined) return null;
  }
  return node;
}

function hasField(obj, field) {
  if (obj == null || typeof obj !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(obj, field)) return false;
  const value = obj[field];
  return value !== undefined && value !== null && value !== '';
}

/**
 * Recursively validate `value` against a JSON-schema-shaped `node`, resolving
 * `$ref` pointers into `rootSchema` before descending. Collects `required`
 * and `enum` violations, both top-level and nested through `properties` and
 * array `items` — the same constraint kinds lib/contracts/validate.mjs's
 * collectSchemaShapeErrors covers, not a general JSON Schema validator.
 */
function collectSchemaShapeErrors(value, node, rootSchema, pathLabel, errors) {
  if (!node || typeof node !== 'object') return;
  if (node.$ref) {
    const resolved = resolveRef(node.$ref, rootSchema);
    if (!resolved) {
      errors.push(`${pathLabel}: unresolved $ref '${node.$ref}'`);
      return;
    }
    collectSchemaShapeErrors(value, resolved, rootSchema, pathLabel, errors);
    return;
  }
  if (value === undefined || value === null) return;

  for (const field of node.required || []) {
    if (!hasField(value, field)) errors.push(`${pathLabel} missing required field: ${field}`);
  }
  if (Array.isArray(node.enum) && !node.enum.includes(value)) {
    errors.push(`${pathLabel} value '${value}' not in allowed enum: ${node.enum.join(', ')}`);
  }
  if (node.properties && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, propSchema] of Object.entries(node.properties)) {
      if (key in value) collectSchemaShapeErrors(value[key], propSchema, rootSchema, `${pathLabel}.${key}`, errors);
    }
  }
  if (node.type === 'array' && node.items && Array.isArray(value)) {
    value.forEach((item, i) => collectSchemaShapeErrors(item, node.items, rootSchema, `${pathLabel}[${i}]`, errors));
  }
}

/**
 * Validate a single Provider Card object against `#/$defs/providerCard`.
 * Returns { ok, errors }.
 */
export function validateProviderCard(card, { schema = loadProviderCardSchema() } = {}) {
  const errors = [];
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    return { ok: false, errors: ['provider card must be an object'] };
  }
  const label = card.id ? `provider '${card.id}'` : 'provider';
  collectSchemaShapeErrors(card, { $ref: '#/$defs/providerCard' }, schema, label, errors);
  return { ok: errors.length === 0, errors };
}

/**
 * Validate a full Provider Card registry document (`{ version, providers }`)
 * against the top-level schema, then each entry against `#/$defs/providerCard`,
 * plus a duplicate-id check the JSON Schema shape itself cannot express.
 * Returns { ok, errors, count }.
 */
export function validateProviderCardRegistry(doc, { schema = loadProviderCardSchema() } = {}) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, errors: ['provider card registry must be an object'], count: 0 };
  }
  for (const field of schema.required || []) {
    if (!hasField(doc, field)) errors.push(`registry missing required field: ${field}`);
  }
  const providers = Array.isArray(doc.providers) ? doc.providers : [];
  const ids = new Set();
  providers.forEach((card, idx) => {
    const label = card?.id ? `provider '${card.id}'` : `providers[${idx}]`;
    if (card?.id) {
      if (ids.has(card.id)) errors.push(`${label}: duplicate provider id`);
      ids.add(card.id);
    }
    collectSchemaShapeErrors(card, { $ref: '#/$defs/providerCard' }, schema, label, errors);
  });
  return { ok: errors.length === 0, errors, count: providers.length };
}

/**
 * Load and validate the on-disk Provider Card registry (default:
 * registry/provider-cards.json). Never throws on a missing/malformed file —
 * returns ok:false with a descriptive error, mirroring
 * lib/registry/validate.mjs's loadCapabilityRegistry.
 */
export function loadProviderCards({ registryPath = DEFAULT_REGISTRY_PATH } = {}) {
  if (!existsSync(registryPath)) {
    return { ok: false, errors: [`provider card registry not found: ${registryPath}`], providers: [], count: 0 };
  }
  let doc;
  try {
    doc = readJson(registryPath);
  } catch (err) {
    return { ok: false, errors: [`provider card registry is not valid JSON: ${err.message}`], providers: [], count: 0 };
  }
  const result = validateProviderCardRegistry(doc);
  return { ...result, providers: doc.providers || [] };
}

/**
 * Look up a single Provider Card by id from the on-disk registry.
 * Returns null if the registry can't be loaded or the id isn't present.
 */
export function findProviderCard(id, opts = {}) {
  const { providers } = loadProviderCards(opts);
  return providers.find((p) => p.id === id) || null;
}

export { DEFAULT_REGISTRY_PATH, SCHEMA_PATH };
