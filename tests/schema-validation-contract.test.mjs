/**
 * tests/schema-validation-contract.test.mjs — canonical validation contract helpers.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  JSON_SCHEMA_SUBSET_KEYWORDS,
  VALIDATION_IMPLEMENTATIONS,
  normalizeValidationResult,
  validationResult,
} from '../lib/schema-validation-contract.mjs';

describe('validationResult', () => {
  it('returns valid=true for an empty error list', () => {
    assert.deepEqual(validationResult([]), { valid: true, errors: [] });
  });

  it('returns valid=false with copied errors', () => {
    const errors = ['$.name: missing required property "name"'];
    const result = validationResult(errors);
    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, errors);
    errors.push('mutated');
    assert.equal(result.errors.length, 1);
  });
});

describe('normalizeValidationResult', () => {
  it('normalizes ok/errors contract shape', () => {
    const result = normalizeValidationResult({ ok: false, errors: ['bad field'] });
    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, ['bad field']);
  });

  it('normalizes string-list failures', () => {
    const result = normalizeValidationResult(['a', 'b']);
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 2);
  });
});

describe('VALIDATION_IMPLEMENTATIONS', () => {
  it('documents flow state as the migrated pilot consumer', () => {
    assert.equal(VALIDATION_IMPLEMENTATIONS.flowState.module, 'lib/flows/schema.mjs');
    assert.equal(VALIDATION_IMPLEMENTATIONS.flowState.export, 'validateSchema');
    assert.ok(JSON_SCHEMA_SUBSET_KEYWORDS.includes('required'));
  });
});
