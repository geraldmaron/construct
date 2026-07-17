/**
 * lib/contracts/extraction-provider.mjs — validator for the extraction provider
 * identity and extraction result contracts (construct-tsyfe.2.1).
 *
 * Defines what an extraction provider IS (schemas/extraction-provider.schema.json:
 * name, version, configFingerprint, declared capabilities) and what a single
 * extraction call MUST report (schemas/extraction-result.schema.json: normalized
 * RichDocument-shaped output, pageRefs/layoutRefs/tables/figures/assets,
 * droppedInfo, qualityReport, sourceGrounding). Net-new contract definition only:
 * no extractor is migrated to it here, no routing logic changes.
 *
 * Validation follows this repo's no-Ajv convention (ADR-0001), the same one
 * lib/contracts/validate.mjs uses for specialists/org contracts: a small
 * recursive walker interprets type/required/enum/properties/items/
 * additionalProperties/minimum/maximum/minLength/maxLength directly from the
 * schema JSON (the same subset lib/flows/schema.mjs independently implements
 * for flow state schemas — kept as a separate copy here rather than a shared
 * import, since each schema-owning domain hand-rolls its own walker in this
 * codebase). Two rules the schema subset cannot express as constraints are
 * layered on top: `losslessReason` is required when `losslessWhereAvailable`
 * is false, and `richDocument` gets its deep block/run validation from
 * lib/rich-document.mjs's own validateRichDocument rather than a duplicate
 * structural walker here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRichDocument } from '../rich-document.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadSchema(name) {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'schemas', name), 'utf8'));
}

export const EXTRACTION_PROVIDER_SCHEMA = loadSchema('extraction-provider.schema.json');
export const EXTRACTION_RESULT_SCHEMA = loadSchema('extraction-result.schema.json');

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, expected) {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  if (expected === 'integer') return actual === 'integer';
  return actual === expected;
}

function validateNode(schema, value, path, errors) {
  if (!schema || typeof schema !== 'object') return;

  const expectedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : null;
  if (expectedTypes && !expectedTypes.some((t) => matchesType(value, t))) {
    errors.push(`${path}: expected type ${expectedTypes.join(' | ')}, got ${typeOf(value)}`);
    return;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: value '${value}' not in enum [${schema.enum.join(', ')}]`);
  }

  const kind = typeOf(value);
  if (kind === 'object') validateObject(schema, value, path, errors);
  else if (kind === 'array') validateArray(schema, value, path, errors);
  else if (kind === 'integer' || kind === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: ${value} is below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: ${value} is above maximum ${schema.maximum}`);
  } else if (kind === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: length ${value.length} is below minLength ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: length ${value.length} is above maxLength ${schema.maxLength}`);
  }
}

function validateObject(schema, value, path, errors) {
  for (const key of schema.required || []) {
    if (!(key in value)) errors.push(`${path}: missing required field "${key}"`);
  }
  const properties = schema.properties || {};
  for (const [key, propValue] of Object.entries(value)) {
    if (properties[key]) validateNode(properties[key], propValue, `${path}.${key}`, errors);
    else if (schema.additionalProperties === false) errors.push(`${path}: unexpected field "${key}"`);
  }
}

function validateArray(schema, value, path, errors) {
  if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: has ${value.length} items, below minItems ${schema.minItems}`);
  if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: has ${value.length} items, above maxItems ${schema.maxItems}`);
  if (schema.items) value.forEach((item, i) => validateNode(schema.items, item, `${path}[${i}]`, errors));
}

/**
 * Validate a provider identity record against schemas/extraction-provider.schema.json.
 * Returns { valid, errors }; errors is empty on success.
 */
export function validateExtractionProvider(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { valid: false, errors: ['extraction provider record must be an object'] };
  }
  validateNode(EXTRACTION_PROVIDER_SCHEMA, doc, 'provider', errors);
  return { valid: errors.length === 0, errors };
}

/**
 * Validate an extraction result against schemas/extraction-result.schema.json,
 * plus the two business rules the schema subset cannot express: losslessReason
 * is required (non-empty) when losslessWhereAvailable is false, and richDocument
 * is deep-validated via lib/rich-document.mjs's validateRichDocument. Returns
 * { valid, errors }; errors is empty on success.
 */
export function validateExtractionResult(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { valid: false, errors: ['extraction result must be an object'] };
  }
  validateNode(EXTRACTION_RESULT_SCHEMA, doc, 'result', errors);

  if (doc.losslessWhereAvailable === false && (typeof doc.losslessReason !== 'string' || !doc.losslessReason.trim())) {
    errors.push('result.losslessReason: required non-empty string when losslessWhereAvailable is false');
  }

  if (doc.richDocument && typeof doc.richDocument === 'object' && !Array.isArray(doc.richDocument)) {
    const richDocResult = validateRichDocument(doc.richDocument);
    for (const err of richDocResult.errors) errors.push(`result.richDocument: ${err}`);
  }

  return { valid: errors.length === 0, errors };
}
