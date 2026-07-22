/**
 * tests/schema-validation.test.mjs — Validate the canonical registry schema.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { loadRegistry } from '../lib/registry/loader.mjs';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const SCHEMA_PATH = path.join(ROOT_DIR, 'schemas', 'unified-registry.schema.json');
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const validate = new AjvJsonSchemaValidator().getValidator(schema);

describe('schemas/unified-registry.schema.json', () => {
  it('declares only canonical peer fields', () => {
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.title, 'Construct Registry');
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, [
      'schemaVersion',
      'workspacePresets',
      'workerProfiles',
      'procedures',
      'capabilities',
      'policies',
    ]);
    for (const field of ['teams', 'groups', 'specialists', 'contracts', 'roles', 'personas', 'scopes', 'workflows']) {
      assert.equal(field in schema.properties, false, field);
    }
  });

  it('defines each canonical entity and nests contracts under Capability', () => {
    for (const definition of ['workspacePreset', 'workerProfile', 'procedure', 'capability', 'capabilityContract', 'policy']) {
      assert.ok(schema.$defs[definition], definition);
    }
    assert.equal(schema.$defs.capability.properties.contracts.type, 'object');
    assert.equal(schema.$defs.capability.properties.contracts.additionalProperties.$ref, '#/$defs/capabilityContract');
  });

  it('accepts the assembled checked-in registry', () => {
    const outcome = validate(loadRegistry());
    assert.equal(outcome.valid, true, outcome.errorMessage);
  });

  it('rejects retired and unknown public fields', () => {
    const registry = structuredClone(loadRegistry());
    registry.teams = {};
    const outcome = validate(registry);
    assert.equal(outcome.valid, false);
  });

  it('rejects retired fields inside canonical entities', () => {
    const registry = structuredClone(loadRegistry());
    registry.workerProfiles.engineer.team = 'engineering';
    const outcome = validate(registry);
    assert.equal(outcome.valid, false);
  });
});
