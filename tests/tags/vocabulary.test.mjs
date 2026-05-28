/**
 * tests/tags/vocabulary.test.mjs — unit tests for the controlled tag vocabulary.
 *
 * Covers loadVocabulary (repo-only and with project overrides) and
 * validateTags (valid, unknown, and exclusive-facet-duplicate scenarios).
 *
 * Run with: node --test tests/tags/vocabulary.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadVocabulary, validateTags, lookupTag, getTagsByFacet, isTagDeprecated, isTagArchived } from '../../lib/tags/vocabulary.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempRoot(vocab, overrides = null) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-vocab-test-'));
  fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'config', 'tag-vocabulary.json'), JSON.stringify(vocab), 'utf8');
  if (overrides) {
    fs.mkdirSync(path.join(tmp, '.cx', 'tags'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.cx', 'tags', 'vocabulary-overrides.json'), JSON.stringify(overrides), 'utf8');
  }
  return tmp;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

const MINIMAL_VOCAB = {
  version: 1,
  facets: {
    'intake-type': { exclusive: true, auto_threshold: 0.80 },
    'lifecycle':   { exclusive: true, auto_threshold: 0.90 },
    'priority':    { exclusive: false, auto_threshold: 0.90 },
  },
  tags: [
    { id: 'intake/bug',         facet: 'intake-type', label: 'Bug',      status: 'active',     synonyms: [] },
    { id: 'intake/research',    facet: 'intake-type', label: 'Research', status: 'active',     synonyms: [] },
    { id: 'lifecycle/draft',    facet: 'lifecycle',   label: 'Draft',    status: 'active',     synonyms: [] },
    { id: 'lifecycle/approved', facet: 'lifecycle',   label: 'Approved', status: 'active',     synonyms: [] },
    { id: 'priority/p0',        facet: 'priority',    label: 'P0',       status: 'active',     synonyms: [] },
    { id: 'tag/deprecated-one', facet: 'priority',    label: 'Old',      status: 'deprecated', synonyms: [] },
    { id: 'tag/archived-one',   facet: 'priority',    label: 'Gone',     status: 'archived',   synonyms: [] },
  ],
};

// ---------------------------------------------------------------------------
// loadVocabulary
// ---------------------------------------------------------------------------

test('loadVocabulary: loads repo vocab and builds tag map', () => {
  const tmp = makeTempRoot(MINIMAL_VOCAB);
  try {
    const vocab = loadVocabulary(tmp);
    assert.equal(vocab.version, 1);
    assert.ok(vocab._tagMap instanceof Map, 'should attach _tagMap');
    assert.equal(vocab._tagMap.size, MINIMAL_VOCAB.tags.length);
  } finally {
    cleanup(tmp);
  }
});

test('loadVocabulary: merges project overrides, new tag added', () => {
  const overrides = {
    version: 1,
    tags: [{ id: 'custom/internal', facet: 'intake-type', label: 'Internal', status: 'active' }],
  };
  const tmp = makeTempRoot(MINIMAL_VOCAB, overrides);
  try {
    const vocab = loadVocabulary(tmp);
    assert.ok(vocab._tagMap.has('custom/internal'), 'override tag should be present');
    assert.ok(vocab._tagMap.has('intake/bug'), 'repo tag should still be present');
  } finally {
    cleanup(tmp);
  }
});

test('loadVocabulary: override shadows existing repo tag', () => {
  const overrides = {
    version: 1,
    tags: [{ id: 'intake/bug', facet: 'intake-type', label: 'Bug (overridden)', status: 'deprecated' }],
  };
  const tmp = makeTempRoot(MINIMAL_VOCAB, overrides);
  try {
    const vocab = loadVocabulary(tmp);
    const entry = vocab._tagMap.get('intake/bug');
    assert.equal(entry.label, 'Bug (overridden)');
    assert.equal(entry.status, 'deprecated');
  } finally {
    cleanup(tmp);
  }
});

test('loadVocabulary: no overrides file is fine', () => {
  const tmp = makeTempRoot(MINIMAL_VOCAB);
  try {
    const vocab = loadVocabulary(tmp);
    assert.equal(vocab.tags.length, MINIMAL_VOCAB.tags.length);
  } finally {
    cleanup(tmp);
  }
});

// ---------------------------------------------------------------------------
// validateTags
// ---------------------------------------------------------------------------

test('validateTags: all valid tags pass', () => {
  const tmp = makeTempRoot(MINIMAL_VOCAB);
  try {
    const vocab = loadVocabulary(tmp);
    const result = validateTags(['intake/bug', 'lifecycle/draft', 'priority/p0'], vocab);
    assert.deepEqual(result.unknown, []);
    assert.deepEqual(result.duplicateFacets, []);
    assert.deepEqual(result.valid, ['intake/bug', 'lifecycle/draft', 'priority/p0']);
  } finally {
    cleanup(tmp);
  }
});

test('validateTags: unknown tag is reported', () => {
  const tmp = makeTempRoot(MINIMAL_VOCAB);
  try {
    const vocab = loadVocabulary(tmp);
    const result = validateTags(['intake/bug', 'totally/unknown'], vocab);
    assert.deepEqual(result.unknown, ['totally/unknown']);
    assert.deepEqual(result.valid, ['intake/bug']);
  } finally {
    cleanup(tmp);
  }
});

test('validateTags: exclusive facet duplicate is reported', () => {
  const tmp = makeTempRoot(MINIMAL_VOCAB);
  try {
    const vocab = loadVocabulary(tmp);
    const result = validateTags(['intake/bug', 'intake/research'], vocab);
    assert.deepEqual(result.valid, ['intake/bug']);
    assert.deepEqual(result.duplicateFacets, ['intake/research']);
    assert.deepEqual(result.unknown, []);
  } finally {
    cleanup(tmp);
  }
});

test('validateTags: non-exclusive facet allows multiple tags', () => {
  const tmp = makeTempRoot(MINIMAL_VOCAB);
  try {
    const vocab = loadVocabulary(tmp);
    const result = validateTags(['priority/p0', 'tag/deprecated-one'], vocab);
    assert.deepEqual(result.duplicateFacets, []);
  } finally {
    cleanup(tmp);
  }
});

test('validateTags: empty array returns all-empty result', () => {
  const tmp = makeTempRoot(MINIMAL_VOCAB);
  try {
    const vocab = loadVocabulary(tmp);
    const result = validateTags([], vocab);
    assert.deepEqual(result, { valid: [], unknown: [], duplicateFacets: [] });
  } finally {
    cleanup(tmp);
  }
});

// ---------------------------------------------------------------------------
// lookupTag
// ---------------------------------------------------------------------------

test('lookupTag: returns entry for known id', () => {
  const tmp = makeTempRoot(MINIMAL_VOCAB);
  try {
    const vocab = loadVocabulary(tmp);
    const entry = lookupTag('intake/bug', vocab);
    assert.ok(entry !== null);
    assert.equal(entry.facet, 'intake-type');
  } finally {
    cleanup(tmp);
  }
});

test('lookupTag: returns null for unknown id', () => {
  const tmp = makeTempRoot(MINIMAL_VOCAB);
  try {
    const vocab = loadVocabulary(tmp);
    assert.equal(lookupTag('does/not-exist', vocab), null);
  } finally {
    cleanup(tmp);
  }
});

// ---------------------------------------------------------------------------
// getTagsByFacet
// ---------------------------------------------------------------------------

test('getTagsByFacet: returns only active tags in facet', () => {
  const tmp = makeTempRoot(MINIMAL_VOCAB);
  try {
    const vocab = loadVocabulary(tmp);
    const intakeTags = getTagsByFacet('intake-type', vocab);
    assert.equal(intakeTags.length, 2);
    assert.ok(intakeTags.every(t => t.facet === 'intake-type' && t.status === 'active'));
  } finally {
    cleanup(tmp);
  }
});

// ---------------------------------------------------------------------------
// isTagDeprecated / isTagArchived
// ---------------------------------------------------------------------------

test('isTagDeprecated: returns true for deprecated tag', () => {
  const tmp = makeTempRoot(MINIMAL_VOCAB);
  try {
    const vocab = loadVocabulary(tmp);
    assert.equal(isTagDeprecated('tag/deprecated-one', vocab), true);
    assert.equal(isTagDeprecated('intake/bug', vocab), false);
  } finally {
    cleanup(tmp);
  }
});

test('isTagArchived: returns true for archived tag', () => {
  const tmp = makeTempRoot(MINIMAL_VOCAB);
  try {
    const vocab = loadVocabulary(tmp);
    assert.equal(isTagArchived('tag/archived-one', vocab), true);
    assert.equal(isTagArchived('intake/bug', vocab), false);
  } finally {
    cleanup(tmp);
  }
});

// ---------------------------------------------------------------------------
// Real vocabulary smoke test
// ---------------------------------------------------------------------------

test('real config/tag-vocabulary.json: all 12 intake types present', () => {
  const repoRoot = path.resolve(new URL(import.meta.url).pathname, '../../..');
  const vocab = loadVocabulary(repoRoot);
  const intakeTags = getTagsByFacet('intake-type', vocab);
  const intakeIds = new Set(intakeTags.map(t => t.id));
  const expected = [
    'intake/bug', 'intake/user-signal', 'intake/experiment', 'intake/architecture',
    'intake/incident', 'intake/security', 'intake/requirement', 'intake/research',
    'intake/ops', 'intake/eval-finding', 'intake/launch-asset', 'intake/legal-compliance',
  ];
  for (const id of expected) {
    assert.ok(intakeIds.has(id), `missing intake tag: ${id}`);
  }
  assert.equal(intakeTags.length, 12);
});

test('real config/tag-vocabulary.json: signal/high-customer-interest has cardinality budget', () => {
  const repoRoot = path.resolve(new URL(import.meta.url).pathname, '../../..');
  const vocab = loadVocabulary(repoRoot);
  const entry = lookupTag('signal/high-customer-interest', vocab);
  assert.ok(entry !== null);
  assert.equal(entry.expected_cardinality, 100);
  assert.equal(entry.cardinality_window_days, 90);
  assert.equal(entry.promote_to_graph, true);
});
