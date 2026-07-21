/**
 * lib/schema-validation-contract.mjs — canonical hand-rolled validation approach.
 *
 * Construct keeps schema validation dependency-free at core boot (ADR-0001).
 * Each domain owns a small validator tuned to its JSON Schema subset or
 * field-rule table. This module documents those families, normalizes result
 * shapes for new code, and supplies shared helpers. Full consolidation of
 * every legacy validator is out of scope here; see
 * docs/guides/reference/material-pattern-inventories.md section 1.
 */

export const JSON_SCHEMA_SUBSET_KEYWORDS = Object.freeze([
  'type',
  'properties',
  'required',
  'enum',
  'items',
  'additionalProperties',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
]);

export const VALIDATION_RESULT_SHAPES = Object.freeze({
  validErrors: Object.freeze({ fields: Object.freeze(['valid', 'errors']), errorsType: 'string[]' }),
  okErrors: Object.freeze({ fields: Object.freeze(['ok', 'errors']), errorsType: 'string[]' }),
  stringList: Object.freeze({ fields: Object.freeze([]), errorsType: 'string[] (empty = pass)' }),
});

export const VALIDATION_IMPLEMENTATIONS = Object.freeze({
  flowState: Object.freeze({
    module: 'lib/flows/schema.mjs',
    export: 'validateSchema',
    shape: 'valid-errors',
    keywords: JSON_SCHEMA_SUBSET_KEYWORDS,
    supportsRef: false,
    supportsUnion: 'type array only',
  }),
  projectConfig: Object.freeze({
    module: 'lib/config/schema.mjs',
    export: 'validateProjectConfig',
    shape: 'valid-errors',
    keywords: 'FIELD_RULES (not JSON Schema)',
    supportsRef: false,
    supportsUnion: false,
  }),
  providerInstance: Object.freeze({
    module: 'lib/providers/instance-config.mjs',
    export: 'validateInstanceConfig',
    shape: 'valid-errors',
    keywords: 'JSON Schema subset + filter delegation',
    supportsRef: false,
    supportsUnion: false,
  }),
  contracts: Object.freeze({
    module: 'lib/contracts/validate.mjs',
    export: 'validateContractsFile',
    shape: 'ok-errors',
    keywords: 'required, enum, properties, items',
    supportsRef: false,
    supportsUnion: false,
  }),
  customRegistry: Object.freeze({
    module: 'lib/registry/custom-schema.mjs',
    export: 'validateCustomWorkerProfile',
    shape: 'string-list',
    keywords: 'domain rules (not JSON Schema)',
    supportsRef: false,
    supportsUnion: false,
  }),
});

export function validationResult(errors = []) {
  const list = Array.isArray(errors) ? [...errors] : [];
  return { valid: list.length === 0, errors: list };
}

export function normalizeValidationResult(result) {
  if (Array.isArray(result)) {
    return validationResult(result);
  }
  if (result && typeof result === 'object') {
    if ('valid' in result) {
      return validationResult(result.errors);
    }
    if ('ok' in result) {
      const errors = Array.isArray(result.errors) ? result.errors : [];
      return { valid: Boolean(result.ok) && errors.length === 0, errors };
    }
  }
  return validationResult(['invalid validation result']);
}
