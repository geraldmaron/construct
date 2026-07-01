/**
 * tests/audit/f10-registry-drift/schema-parity.red.mjs — F10 [R15] config schema vocabulary split.
 *
 * RED fixtures (must FAIL against current code). The published JSON Schema and the runtime
 * validator disagree on the core config vocabulary:
 *   - schemas/project-config.schema.json:25-30  declares a `profile` property (enum
 *     ["rnd","operations","creative","research"], default "rnd").
 *   - lib/config/schema.mjs:62,159  declares a `scope` field (default DEFAULT_SCOPE_ID="rnd",
 *     free string maxLength 40, no enum) and has NO `profile` rule.
 *   - lib/scopes/loader.mjs:88  reads `raw?.scope` from construct.config.json at runtime.
 *   - lib/sandbox.mjs:58  WRITES `cfg.profile = profile` into construct.config.json.
 * A user who sets the schema-documented `profile` key gets a value the scope loader never
 * reads (it looks for `scope`); a user who sets `scope` writes a key the JSON Schema does not
 * define (it only validates because additionalProperties:true). The "single source of truth"
 * config file has two names for one concept, split across the two artifacts that are supposed
 * to agree.
 *
 * Contract these encode (CX-AUDIT-REGISTRY-001): one config definition generates BOTH the
 * JSON Schema and the runtime validator, so the key name and its allowed values are identical
 * in both. Each test loads both artifacts and asserts they agree; today they diverge, so the
 * asserts fail until the schemas are unified onto one vocabulary.
 *
 * Hermetic: pure in-process reads of two committed repo files. No tmpdir, no network, no host
 * state. The repo root is resolved from this file's location.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { FIELD_RULES, DEFAULT_PROJECT_CONFIG } from '../../../lib/config/schema.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function loadJsonSchema() {
  const file = path.join(REPO_ROOT, 'schemas', 'project-config.schema.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// The two artifacts must name the active-organizational-unit field identically. The JSON
// Schema calls it `profile`; the runtime calls it `scope`. Exactly one name can be the
// source of truth — assert both artifacts expose the same key.

test('[R15] JSON Schema and runtime validator name the active-unit field identically', () => {
  const jsonSchema = loadJsonSchema();
  const jsonHasProfile = Object.prototype.hasOwnProperty.call(jsonSchema.properties, 'profile');
  const jsonHasScope = Object.prototype.hasOwnProperty.call(jsonSchema.properties, 'scope');
  const runtimeHasProfile = Object.prototype.hasOwnProperty.call(FIELD_RULES, 'profile');
  const runtimeHasScope = Object.prototype.hasOwnProperty.call(FIELD_RULES, 'scope');

  const jsonKey = jsonHasProfile ? 'profile' : jsonHasScope ? 'scope' : null;
  const runtimeKey = runtimeHasProfile ? 'profile' : runtimeHasScope ? 'scope' : null;

  assert.equal(
    jsonKey,
    runtimeKey,
    `JSON Schema names the active-unit field "${jsonKey}" but the runtime validator names it "${runtimeKey}" — one config, two vocabularies`,
  );
});

// The default value must round-trip: whatever key the JSON Schema documents must carry a
// default in the runtime's frozen DEFAULT_PROJECT_CONFIG under the SAME key. Today the JSON
// Schema documents `profile` with default "rnd", but DEFAULT_PROJECT_CONFIG.profile is
// undefined (the default lives under `scope`).

test('[R15] runtime default config carries the field the JSON Schema documents', () => {
  const jsonSchema = loadJsonSchema();
  const documentedKey = Object.prototype.hasOwnProperty.call(jsonSchema.properties, 'profile')
    ? 'profile'
    : 'scope';

  assert.notEqual(
    DEFAULT_PROJECT_CONFIG[documentedKey],
    undefined,
    `JSON Schema documents "${documentedKey}" with a default, but DEFAULT_PROJECT_CONFIG.${documentedKey} is undefined — the runtime default uses a different key`,
  );
});

// The allowed-value contract must match. The JSON Schema constrains the field to an enum;
// the runtime should enforce the same closed set. Today the JSON Schema has
// profile.enum=[...] while the runtime `scope` rule has no enum (any string ≤40 chars), so
// the two artifacts admit different value sets for the same concept.

test('[R15] JSON Schema enum and runtime enum admit the same value set', () => {
  const jsonSchema = loadJsonSchema();
  const jsonProp = jsonSchema.properties.profile ?? jsonSchema.properties.scope ?? {};
  const jsonEnum = Array.isArray(jsonProp.enum) ? [...jsonProp.enum].sort() : null;

  const runtimeRule = FIELD_RULES.profile ?? FIELD_RULES.scope ?? {};
  const runtimeEnum = Array.isArray(runtimeRule.enum) ? [...runtimeRule.enum].sort() : null;

  assert.deepEqual(
    runtimeEnum,
    jsonEnum,
    `JSON Schema enum is ${JSON.stringify(jsonEnum)} but runtime enum is ${JSON.stringify(runtimeEnum)} — the two validators disagree on allowed values`,
  );
});
