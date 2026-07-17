/**
 * tests/provider-card-schema.test.mjs — Provider Card schema + validator unit tests.
 *
 * Exercises lib/providers/provider-card.mjs's validateProviderCard and
 * validateProviderCardRegistry against schemas/provider-card.schema.json,
 * using tests/fixtures/provider-cards/ valid/invalid fixtures
 * (construct-4uxq0.13.7).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  loadProviderCardSchema,
  validateProviderCard,
  validateProviderCardRegistry,
} from '../lib/providers/provider-card.mjs';

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'provider-cards');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

test('schema is well-formed JSON with the required top-level shape', () => {
  const schema = loadProviderCardSchema();
  assert.equal(schema.type, 'object');
  assert.deepEqual(schema.required, ['version', 'providers']);
  assert.ok(schema.$defs.providerCard, 'schema declares #/$defs/providerCard');
  assert.deepEqual(schema.$defs.providerCard.required, [
    'id', 'kind', 'versionPolicy', 'healthCheck', 'fallback', 'owner', 'removalCriteria',
  ]);
});

test('valid fixture registry passes validation', () => {
  const doc = loadFixture('valid-registry.json');
  const result = validateProviderCardRegistry(doc);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.count, 2);
});

test('each card in the valid fixture also passes single-card validation', () => {
  const doc = loadFixture('valid-registry.json');
  for (const card of doc.providers) {
    const result = validateProviderCard(card);
    assert.equal(result.ok, true, `${card.id}: ${result.errors.join('; ')}`);
  }
});

test('missing required field is rejected and named', () => {
  const doc = loadFixture('malformed-missing-owner.json');
  const result = validateProviderCardRegistry(doc);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => e.includes('missing required field: owner')),
    `expected an 'owner' error, got: ${result.errors.join('; ')}`,
  );
});

test('invalid kind enum value is rejected and named', () => {
  const doc = loadFixture('malformed-bad-kind-enum.json');
  const result = validateProviderCardRegistry(doc);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => e.includes('totally-not-a-real-kind') && e.includes('not in allowed enum')),
    `expected a kind-enum error, got: ${result.errors.join('; ')}`,
  );
});

test('duplicate provider ids are rejected', () => {
  const doc = loadFixture('valid-registry.json');
  const dup = { ...doc, providers: [...doc.providers, doc.providers[0]] };
  const result = validateProviderCardRegistry(dup);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('duplicate provider id')));
});

test('registry missing top-level "providers" field is rejected', () => {
  const result = validateProviderCardRegistry({ version: 1 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("missing required field: providers")));
});

test('non-object input is rejected without throwing', () => {
  assert.equal(validateProviderCardRegistry(null).ok, false);
  assert.equal(validateProviderCardRegistry([1, 2, 3]).ok, false);
  assert.equal(validateProviderCard('not-an-object').ok, false);
});
