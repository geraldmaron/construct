/**
 * tests/flows-schema.test.mjs — hand-rolled JSON-Schema subset validator.
 *
 * Pins type/required/enum/nested-object/array-items validation and confirms
 * the validator reports every violation rather than failing fast on the
 * first one, since the engine surfaces the full error list on a rejected
 * state transition.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { validateSchema } from '../lib/flows/schema.mjs';

test('accepts a value matching a flat object schema', () => {
  const schema = { type: 'object', required: ['name'], properties: { name: { type: 'string' }, age: { type: 'integer' } } };
  const result = validateSchema(schema, { name: 'a', age: 3 });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('reports a missing required property', () => {
  const schema = { type: 'object', required: ['name'] };
  const result = validateSchema(schema, {});
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /missing required property "name"/);
});

test('reports a type mismatch', () => {
  const schema = { type: 'object', properties: { count: { type: 'number' } } };
  const result = validateSchema(schema, { count: 'not a number' });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /expected type number/);
});

test('rejects a value outside an enum', () => {
  const schema = { type: 'object', properties: { status: { enum: ['open', 'closed'] } } };
  const result = validateSchema(schema, { status: 'pending' });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /not in enum/);
});

test('validates nested objects and array items', () => {
  const schema = {
    type: 'object',
    properties: {
      items: { type: 'array', items: { type: 'object', required: ['id'] } },
    },
  };
  const result = validateSchema(schema, { items: [{ id: 1 }, {}] });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /\$\.items\[1\]/);
});

test('reports every violation instead of stopping at the first', () => {
  const schema = { type: 'object', required: ['a', 'b'] };
  const result = validateSchema(schema, {});
  assert.equal(result.errors.length, 2);
});

test('rejects an unexpected property when additionalProperties is false', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false };
  const result = validateSchema(schema, { a: 'x', b: 'y' });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /unexpected property "b"/);
});
