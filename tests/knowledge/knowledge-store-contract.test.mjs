/**
 * tests/knowledge/knowledge-store-contract.test.mjs — KnowledgeStore provider
 * contract fixture tests (construct-tsyfe.7.1).
 *
 * Proves each of the four named modes returns a distinct, schema-valid
 * capability declaration covering all six axes (AC1); a minimal-local
 * declaration validates without vector-search or shared-storage present
 * (AC2); a team declaration requires shared-storage present (AC3); and a
 * broken declaration fails naming the specific missing/invalid field.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KNOWLEDGE_STORE_SCHEMA_VERSION,
  KNOWLEDGE_STORE_AXES,
  KNOWLEDGE_STORE_MODES,
  KNOWLEDGE_STORE_MODE_DECLARATIONS,
  getKnowledgeStoreCapability,
  checkKnowledgeStoreCapability,
  assertKnowledgeStoreCapability,
} from '../../lib/engine/knowledge-store-contract.mjs';

test('KNOWLEDGE_STORE_MODES contains exactly the four named modes', () => {
  assert.deepEqual([...KNOWLEDGE_STORE_MODES].sort(), [
    'capable-local-semantic', 'minimal-local', 'remote-where-justified', 'team',
  ]);
});

test('AC1: every mode returns a distinct, schema-valid capability declaration covering all six axes', () => {
  const seen = new Set();
  for (const mode of KNOWLEDGE_STORE_MODES) {
    const decl = getKnowledgeStoreCapability(mode);
    assert.ok(decl, `${mode}: no declaration returned`);
    assert.equal(decl.mode, mode);
    assert.equal(decl.schemaVersion, KNOWLEDGE_STORE_SCHEMA_VERSION);
    assert.deepEqual(Object.keys(decl.axes).sort(), [...KNOWLEDGE_STORE_AXES].sort());

    const { ok, errors } = checkKnowledgeStoreCapability(decl);
    assert.ok(ok, `${mode}: ${errors.join('; ')}`);

    const fingerprint = JSON.stringify(decl);
    assert.ok(!seen.has(fingerprint), `${mode}: declaration is not distinct from a previous mode`);
    seen.add(fingerprint);
  }
});

test('getKnowledgeStoreCapability returns null for an unknown mode', () => {
  assert.equal(getKnowledgeStoreCapability('nonexistent-mode'), null);
});

test('AC2: minimal-local validates without vector-search or shared-storage present', () => {
  const decl = KNOWLEDGE_STORE_MODE_DECLARATIONS['minimal-local'];
  assert.equal(decl.axes.vectorSearch.present, false);
  assert.equal(decl.axes.sharedStorage.present, false);
  assert.equal(decl.axes.embedding.present, false);
  assert.equal(decl.axes.reranking.present, false);
  assert.equal(decl.axes.keywordSearch.present, true);
  assert.equal(decl.axes.metadataStore.present, true);

  const { ok, errors } = checkKnowledgeStoreCapability(decl);
  assert.ok(ok, errors.join('; '));
});

test('AC3: team mode requires a shared-storage capability to be present', () => {
  const decl = KNOWLEDGE_STORE_MODE_DECLARATIONS.team;
  assert.equal(decl.axes.sharedStorage.present, true);
  assert.ok(decl.axes.sharedStorage.providerId);

  const broken = {
    ...decl,
    axes: { ...decl.axes, sharedStorage: { present: false } },
  };
  const { ok, errors } = checkKnowledgeStoreCapability(broken);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('sharedStorage')), errors.join('; '));
});

test('capable-local-semantic requires vector-search and embedding present', () => {
  const decl = KNOWLEDGE_STORE_MODE_DECLARATIONS['capable-local-semantic'];
  assert.equal(decl.axes.vectorSearch.present, true);
  assert.equal(decl.axes.embedding.present, true);
  assert.ok(decl.axes.vectorSearch.providerId);
  assert.ok(decl.axes.embedding.providerId);

  const missingEmbedding = {
    ...decl,
    axes: { ...decl.axes, embedding: { present: false } },
  };
  const { ok, errors } = checkKnowledgeStoreCapability(missingEmbedding);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('embedding')), errors.join('; '));
});

test('remote-where-justified requires a non-empty justification', () => {
  const decl = KNOWLEDGE_STORE_MODE_DECLARATIONS['remote-where-justified'];
  assert.ok(decl.justification && decl.justification.trim().length > 0);

  const unjustified = { ...decl, justification: null };
  const { ok, errors } = checkKnowledgeStoreCapability(unjustified);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('justification')), errors.join('; '));
});

test('any axis marked remote:true requires a declaration-level justification, regardless of mode', () => {
  const decl = KNOWLEDGE_STORE_MODE_DECLARATIONS['capable-local-semantic'];
  const withRemoteEmbedding = {
    ...decl,
    axes: {
      ...decl.axes,
      embedding: { present: true, providerId: 'lib/storage/embeddings-openai.mjs', remote: true },
    },
  };
  const { ok, errors } = checkKnowledgeStoreCapability(withRemoteEmbedding);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('justification')), errors.join('; '));

  const justified = { ...withRemoteEmbedding, justification: 'Operator opted into a hosted embedding provider for higher recall.' };
  const result = checkKnowledgeStoreCapability(justified);
  assert.ok(result.ok, result.errors.join('; '));
});

test('known-bad: a declaration missing a required axis fails, naming the missing field', () => {
  const decl = KNOWLEDGE_STORE_MODE_DECLARATIONS['minimal-local'];
  const { vectorSearch: _vectorSearch, ...axesWithoutVectorSearch } = decl.axes;
  const broken = { ...decl, axes: axesWithoutVectorSearch };

  const { ok, errors } = checkKnowledgeStoreCapability(broken);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e === 'axes.vectorSearch is required'), errors.join('; '));
});

test('known-bad: present:true without a providerId fails, naming the axis', () => {
  const decl = KNOWLEDGE_STORE_MODE_DECLARATIONS['minimal-local'];
  const broken = {
    ...decl,
    axes: { ...decl.axes, vectorSearch: { present: true } },
  };
  const { ok, errors } = checkKnowledgeStoreCapability(broken);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('axes.vectorSearch.providerId')), errors.join('; '));
});

test('known-bad: an unrecognized axis key is rejected by name', () => {
  const decl = KNOWLEDGE_STORE_MODE_DECLARATIONS['minimal-local'];
  const broken = { ...decl, axes: { ...decl.axes, fullTextIndex: { present: true, providerId: 'x' } } };
  const { ok, errors } = checkKnowledgeStoreCapability(broken);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e === 'axes.fullTextIndex is not a recognized capability axis'), errors.join('; '));
});

test('assertKnowledgeStoreCapability throws for a broken declaration and passes for every canonical mode', () => {
  for (const mode of KNOWLEDGE_STORE_MODES) {
    assert.doesNotThrow(() => assertKnowledgeStoreCapability(getKnowledgeStoreCapability(mode)));
  }
  assert.throws(() => assertKnowledgeStoreCapability({ schemaVersion: 1, mode: 'team', axes: {} }), /shared-storage|required/i);
});

test('AC4: no external schema-validation library is referenced by the contract module', () => {
  assert.doesNotMatch(String(checkKnowledgeStoreCapability), /ajv|zod/i);
});
