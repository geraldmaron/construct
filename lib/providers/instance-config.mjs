/**
 * lib/providers/instance-config.mjs — provider instance config persistence + validation.
 *
 * Backs `construct provider add|configure` (LMCP-B12). An "instance config"
 * is the per-project, per-provider-id settings block (Jira project keys,
 * GitHub repo, Slack channel, plus the ADR-0060 `filter` block) — distinct
 * from `lib/providers/registry.mjs`'s `.construct/providers.json`, which registers
 * *which provider module* answers for an id, not its call-time config.
 *
 * Storage: one JSON file per provider id at `<rootDir>/.construct/providers/<id>.json`,
 * `{ providerId, config, updatedAt }`. Human-reviewable, git-trackable, and
 * namespaced per id so concurrent `configure` calls on different providers
 * never collide on one shared file.
 *
 * Validation walks the provider's `configSchema` (a JSON-Schema draft
 * 2020-12 subset: `type`, `properties`, `required`, `enum`, `pattern`,
 * `minimum`/`maximum`, `additionalProperties`) by hand — no schema engine
 * dependency, mirroring the hand-rolled approach `contract.mjs` already
 * takes for the ADR-0060 filter block. `config.filter`, when present, is
 * delegated to `validateFilterConfig()` from `contract.mjs` (LMCP-B11) so
 * the two validators can never drift on filter-block semantics. Every
 * rejection carries a JSON-Pointer-style path (`config.<field>` or
 * `config.filter.<...>`) so the caller can name the offending key.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { configPath } from '../config-dir.mjs';

import { validateFilterConfig } from './contract.mjs';
import { SCOPE_KEYS, PREDICATE_KEYS } from './filter-schema.mjs';

// `filter.scope.*` and most `filter.predicates.*` leaves are always arrays
// per the ADR-0060 grammar (filter-schema.mjs); `updatedSince` is the one
// scalar-string predicate. A single `--filter.scope.projects ABC` must
// therefore land as `["ABC"]`, not the bare string, even on first occurrence.
const ALWAYS_ARRAY_FILTER_LEAVES = new Set([
  ...SCOPE_KEYS.map((k) => `filter.scope.${k}`),
  ...PREDICATE_KEYS.filter((k) => k !== 'updatedSince').map((k) => `filter.predicates.${k}`),
]);

export function instanceConfigPath(rootDir, providerId) {
  return configPath(rootDir, 'providers', `${providerId}.json`);
}

export function readInstanceConfig(rootDir, providerId) {
  const filePath = instanceConfigPath(rootDir, providerId);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function writeInstanceConfig(rootDir, providerId, config) {
  const filePath = instanceConfigPath(rootDir, providerId);
  mkdirSync(dirname(filePath), { recursive: true });
  const record = { providerId, config, updatedAt: new Date().toISOString() };
  writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n');
  return record;
}

/**
 * Build the default config object from a JSON-Schema `properties` map:
 * every property that declares a `default` is seeded with it. Properties
 * without a default are omitted — `provider add` scaffolds only what the
 * schema actually commits to, not placeholder nulls.
 */
export function defaultsFromSchema(configSchema) {
  const defaults = {};
  const properties = configSchema?.properties || {};
  for (const [key, propSchema] of Object.entries(properties)) {
    if (propSchema && Object.prototype.hasOwnProperty.call(propSchema, 'default')) {
      defaults[key] = propSchema.default;
    }
  }
  return defaults;
}

function typeMatches(value, type) {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    default: return true;
  }
}

/**
 * Validate one property value against its JSON-Schema property descriptor.
 * Returns an array of error strings (empty when valid); each string is
 * prefixed with `path` so nested callers can build a JSON-Pointer trail.
 */
function validateProperty(path, value, propSchema) {
  const errors = [];
  if (!propSchema) return errors;

  if (propSchema.enum && !propSchema.enum.includes(value)) {
    errors.push(`${path}: must be one of [${propSchema.enum.join(', ')}], got ${JSON.stringify(value)}`);
    return errors;
  }

  if (propSchema.type && !typeMatches(value, propSchema.type)) {
    errors.push(`${path}: must be of type ${propSchema.type}, got ${JSON.stringify(value)}`);
    return errors;
  }

  if (propSchema.pattern && typeof value === 'string' && !new RegExp(propSchema.pattern).test(value)) {
    errors.push(`${path}: does not match pattern ${propSchema.pattern}`);
  }

  if (typeof value === 'number') {
    if (propSchema.minimum !== undefined && value < propSchema.minimum) {
      errors.push(`${path}: must be >= ${propSchema.minimum}, got ${value}`);
    }
    if (propSchema.maximum !== undefined && value > propSchema.maximum) {
      errors.push(`${path}: must be <= ${propSchema.maximum}, got ${value}`);
    }
  }

  return errors;
}

/**
 * Validate a merged instance config against a provider's declared
 * `configSchema`, plus (when the config carries a `filter` key) the
 * ADR-0060 filter block via `validateFilterConfig()`. Returns
 * `{ valid: true }` or `{ valid: false, errors: string[] }` — never throws,
 * so callers (CLI + tests) get a uniform result shape to report from.
 *
 * `filter` is accepted on every provider config regardless of whether the
 * schema's `properties` declares it: the ADR-0060 block is a cross-cutting
 * concern layered on top of the provider-specific schema, not a provider-
 * specific property.
 */
export function validateInstanceConfig(providerId, configSchema, config = {}) {
  const errors = [];
  const schema = configSchema || {};
  const properties = schema.properties || {};
  const { filter, ...rest } = config || {};

  for (const required of schema.required || []) {
    if (!(required in rest)) {
      errors.push(`config.${required}: required property missing`);
    }
  }

  for (const [key, value] of Object.entries(rest)) {
    const path = `config.${key}`;
    if (!(key in properties)) {
      if (schema.additionalProperties === false) {
        errors.push(`${path}: unknown property (not declared in configSchema)`);
      }
      continue;
    }
    errors.push(...validateProperty(path, value, properties[key]));
  }

  if (filter !== undefined) {
    try {
      validateFilterConfig(providerId, filter);
    } catch (err) {
      errors.push(`config.filter: ${err.message}`);
    }
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true };
}

/**
 * Apply `--key value` CLI overrides onto a base config object. Dotted keys
 * (`scope.projects`) address nested objects; repeated flags for an array
 * leaf (`filter.scope.projects`) accumulate rather than overwrite, so
 * `--filter.scope.projects ABC --filter.scope.projects DEF` yields
 * `["ABC", "DEF"]` in one `configure` call.
 */
export function applyOverrides(base, overrides) {
  const result = JSON.parse(JSON.stringify(base || {}));

  // Accumulation only fires for a keyPath repeated within *this* override
  // batch — a pre-existing base value (a schema default or a prior
  // `configure` call) is a plain overwrite, never folded into an array.
  const touched = new Set();

  for (const { keyPath, value } of overrides) {
    const segments = keyPath.split('.');
    let cursor = result;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      if (typeof cursor[segment] !== 'object' || cursor[segment] === null || Array.isArray(cursor[segment])) {
        cursor[segment] = {};
      }
      cursor = cursor[segment];
    }
    const leaf = segments[segments.length - 1];
    const parsed = parseFlagValue(value);
    if (touched.has(keyPath)) {
      cursor[leaf] = Array.isArray(cursor[leaf]) ? [...cursor[leaf], parsed] : [cursor[leaf], parsed];
    } else if (ALWAYS_ARRAY_FILTER_LEAVES.has(keyPath)) {
      cursor[leaf] = [parsed];
      touched.add(keyPath);
    } else {
      cursor[leaf] = parsed;
      touched.add(keyPath);
    }
  }
  return result;
}

function parseFlagValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}
