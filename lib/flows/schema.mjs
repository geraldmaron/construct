/**
 * lib/flows/schema.mjs — hand-rolled JSON-Schema subset validator.
 *
 * Covers the subset flow state schemas need: type (string/number/integer/
 * boolean/object/array/null, or an array of those for a union), properties,
 * required, enum, items, additionalProperties, and minimum/maximum/minLength/
 * maxLength/minItems/maxItems. No $ref, no allOf/anyOf/oneOf, no format
 * keywords — deliberately not a general JSON-Schema implementation, only the
 * smallest validator that lets a flow definition describe a typed state
 * object and reject an invalid transition, per ADR-0001's zero-npm-
 * dependency-core mandate (no ajv/zod).
 */

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

  if (schema.enum && !schema.enum.some((allowed) => deepEqual(allowed, value))) {
    errors.push(`${path}: value not in enum [${schema.enum.map(String).join(', ')}]`);
  }

  if (typeOf(value) === 'object') {
    validateObject(schema, value, path, errors);
  } else if (typeOf(value) === 'array') {
    validateArray(schema, value, path, errors);
  } else if (typeOf(value) === 'number' || typeOf(value) === 'integer') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: ${value} is below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: ${value} is above maximum ${schema.maximum}`);
  } else if (typeOf(value) === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: length ${value.length} is below minLength ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: length ${value.length} is above maxLength ${schema.maxLength}`);
  }
}

function validateObject(schema, value, path, errors) {
  const properties = schema.properties || {};
  for (const key of schema.required || []) {
    if (!(key in value)) errors.push(`${path}: missing required property "${key}"`);
  }
  for (const [key, propValue] of Object.entries(value)) {
    if (properties[key]) {
      validateNode(properties[key], propValue, `${path}.${key}`, errors);
    } else if (schema.additionalProperties === false) {
      errors.push(`${path}: unexpected property "${key}"`);
    }
  }
}

function validateArray(schema, value, path, errors) {
  if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: has ${value.length} items, below minItems ${schema.minItems}`);
  if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: has ${value.length} items, above maxItems ${schema.maxItems}`);
  if (schema.items) {
    value.forEach((item, i) => validateNode(schema.items, item, `${path}[${i}]`, errors));
  }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual(a[k], b[k]));
}

export function validateSchema(schema, value) {
  const errors = [];
  validateNode(schema, value, '$', errors);
  return { valid: errors.length === 0, errors };
}
