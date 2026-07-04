/**
 * tests/providers/feedback-provider.test.mjs — feedback provider tests.
 *
 * Verifies:
 *   - JSONL and CSV fixtures normalize to identical feedback-item shapes
 *   - Malformed rows are skipped with a visible per-file warning count
 *   - Every item carries provenance (file + row/line) and an N1 trust label
 *   - search() finds matching feedback text
 *   - health() reports unavailable for missing root / bad config
 *   - Provider loads from manifest with zero central dispatch edits
 *     (resolveProviders() discovers it purely via lib/extensions/manifests/)
 */

import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { create } from '../../lib/providers/feedback/index.mjs';
import { TRUST_LEVELS } from '../../lib/security/trust.mjs';
import { resolveProviders } from '../../lib/providers/registry.mjs';

const TEST_ROOT = join(tmpdir(), `construct-feedback-provider-test-${Date.now()}`);

const FIELDS = { id: 'id', text: 'text', author: 'author', date: 'date', source: 'source', tags: 'tags' };

function setupFixtures() {
  mkdirSync(TEST_ROOT, { recursive: true });

  const jsonlLines = [
    JSON.stringify({ id: '1', text: 'Checkout is confusing', author: 'alice', date: '2026-06-01', source: 'survey', tags: ['ux', 'checkout'] }),
    'not valid json{{{',
    JSON.stringify({ id: '2', text: 'Love the new dashboard', author: 'bob', date: '2026-06-02', source: 'survey', tags: ['praise'] }),
    JSON.stringify({ text: 'missing id field' }),
    JSON.stringify({ id: '3', text: '' }),
    '',
  ].join('\n');
  writeFileSync(join(TEST_ROOT, 'batch1.jsonl'), jsonlLines, 'utf8');

  const csvLines = [
    'id,text,author,date,source,tags',
    '1,Checkout is confusing,alice,2026-06-01,survey,ux;checkout',
    '2,Love the new dashboard,bob,2026-06-02,survey,praise',
    '3,too,few,columns',
    ',missing id here,carol,2026-06-03,survey,bug',
  ].join('\n');
  writeFileSync(join(TEST_ROOT, 'batch1.csv'), csvLines, 'utf8');
}

function teardownFixtures() {
  rmSync(TEST_ROOT, { recursive: true, force: true });
}

describe('feedback provider — contract', () => {
  const provider = create();

  it('exports meta with id, displayName, capabilities', () => {
    assert.equal(provider.meta.id, 'feedback');
    assert.equal(provider.meta.displayName, 'Feedback / Customer Input');
    assert.deepEqual(provider.meta.capabilities, ['read', 'search']);
  });

  it('exports configSchema with root, format, fields required', () => {
    assert.ok(provider.configSchema);
    assert.ok(provider.configSchema.properties.root);
    assert.ok(provider.configSchema.properties.format);
    assert.ok(provider.configSchema.properties.fields);
    assert.deepEqual(provider.configSchema.required, ['root', 'format', 'fields']);
  });

  it('exports health, read, and search methods', () => {
    assert.equal(typeof provider.health, 'function');
    assert.equal(typeof provider.read, 'function');
    assert.equal(typeof provider.search, 'function');
  });
});

describe('feedback provider — health', () => {
  before(() => setupFixtures());
  after(() => teardownFixtures());

  const provider = create();

  it('returns ok=true for readable drop-directory', async () => {
    const health = await provider.health({ root: TEST_ROOT, format: 'jsonl' });
    assert.equal(health.ok, true);
    assert.ok(health.detail.includes('readable'));
  });

  it('returns ok=false for missing root', async () => {
    const health = await provider.health({ root: '/nonexistent/path/12345', format: 'jsonl' });
    assert.equal(health.ok, false);
    assert.ok(typeof health.detail === 'string');
  });

  it('returns ok=false when root is not set', async () => {
    const health = await provider.health({});
    assert.equal(health.ok, false);
    assert.ok(health.detail.includes('not set'));
  });
});

describe('feedback provider — JSONL/CSV identical normalization', () => {
  before(() => setupFixtures());
  after(() => teardownFixtures());

  const provider = create();

  it('normalizes JSONL rows to the feedback-item shape', async () => {
    const items = await provider.read({ root: TEST_ROOT, format: 'jsonl', fields: FIELDS });
    assert.ok(items.length >= 2);
    const first = items.find((i) => i.id === '1');
    assert.ok(first);
    assert.equal(first.text, 'Checkout is confusing');
    assert.equal(first.author, 'alice');
    assert.equal(first.date, '2026-06-01');
    assert.equal(first.source, 'survey');
    assert.deepEqual(first.tags, ['ux', 'checkout']);
    assert.deepEqual(Object.keys(first).sort(), ['_trust', 'author', 'date', 'id', 'provenance', 'source', 'tags', 'text'].sort());
  });

  it('normalizes CSV rows to the same feedback-item shape', async () => {
    const items = await provider.read({ root: TEST_ROOT, format: 'csv', fields: FIELDS });
    assert.ok(items.length >= 2);
    const first = items.find((i) => i.id === '1');
    assert.ok(first);
    assert.equal(first.text, 'Checkout is confusing');
    assert.equal(first.author, 'alice');
    assert.equal(first.date, '2026-06-01');
    assert.equal(first.source, 'survey');
    assert.deepEqual(first.tags, ['ux', 'checkout']);
    assert.deepEqual(Object.keys(first).sort(), ['_trust', 'author', 'date', 'id', 'provenance', 'source', 'tags', 'text'].sort());
  });

  it('JSONL and CSV items for the same id have identical normalized shape', async () => {
    const jsonlItems = await provider.read({ root: TEST_ROOT, format: 'jsonl', fields: FIELDS });
    const csvItems = await provider.read({ root: TEST_ROOT, format: 'csv', fields: FIELDS });

    const jsonlItem = jsonlItems.find((i) => i.id === '2');
    const csvItem = csvItems.find((i) => i.id === '2');

    assert.equal(jsonlItem.text, csvItem.text);
    assert.equal(jsonlItem.author, csvItem.author);
    assert.equal(jsonlItem.date, csvItem.date);
    assert.equal(jsonlItem.source, csvItem.source);
    assert.deepEqual(jsonlItem.tags, csvItem.tags);
    assert.deepEqual(Object.keys(jsonlItem).sort(), Object.keys(csvItem).sort());
  });
});

describe('feedback provider — malformed row handling', () => {
  before(() => setupFixtures());
  after(() => teardownFixtures());

  const provider = create();

  it('skips malformed JSONL rows without crashing and warns with a count', async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (msg) => warnings.push(msg);
    try {
      const items = await provider.read({ root: TEST_ROOT, format: 'jsonl', fields: FIELDS });
      assert.ok(Array.isArray(items));
      const ids = items.map((i) => i.id);
      assert.ok(!ids.includes('3'), 'row with empty text should be skipped');
    } finally {
      console.warn = originalWarn;
    }
    assert.ok(warnings.some((w) => w.includes('batch1.jsonl') && /skipped 3 malformed row/.test(w)),
      `expected a warning naming batch1.jsonl with a skip count, got: ${JSON.stringify(warnings)}`);
  });

  it('skips malformed CSV rows without crashing and warns with a count', async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (msg) => warnings.push(msg);
    try {
      const items = await provider.read({ root: TEST_ROOT, format: 'csv', fields: FIELDS });
      assert.ok(Array.isArray(items));
      const ids = items.map((i) => i.id);
      assert.ok(!ids.includes('3'), 'row with mismatched column count should be skipped');
    } finally {
      console.warn = originalWarn;
    }
    assert.ok(warnings.some((w) => w.includes('batch1.csv') && /skipped 2 malformed row/.test(w)),
      `expected a warning naming batch1.csv with a skip count, got: ${JSON.stringify(warnings)}`);
  });

  it('does not throw for a directory containing only malformed content', async () => {
    const emptyRoot = join(TEST_ROOT, 'all-bad');
    mkdirSync(emptyRoot, { recursive: true });
    writeFileSync(join(emptyRoot, 'bad.jsonl'), 'not json\nnope{{{\n', 'utf8');

    const items = await provider.read({ root: emptyRoot, format: 'jsonl', fields: FIELDS });
    assert.deepEqual(items, []);
  });
});

describe('feedback provider — provenance and N1 trust label', () => {
  before(() => setupFixtures());
  after(() => teardownFixtures());

  const provider = create();

  it('every JSONL item carries file + row provenance', async () => {
    const items = await provider.read({ root: TEST_ROOT, format: 'jsonl', fields: FIELDS });
    for (const item of items) {
      assert.equal(item.provenance.file, 'batch1.jsonl');
      assert.equal(typeof item.provenance.row, 'number');
      assert.ok(item.provenance.row > 0);
    }
  });

  it('every CSV item carries file + row provenance', async () => {
    const items = await provider.read({ root: TEST_ROOT, format: 'csv', fields: FIELDS });
    for (const item of items) {
      assert.equal(item.provenance.file, 'batch1.csv');
      assert.equal(typeof item.provenance.row, 'number');
      assert.ok(item.provenance.row > 1, 'row number should account for the header row');
    }
  });

  it('every item is stamped with the N1 EXTERNAL_UNAUTHENTICATED trust level', async () => {
    const jsonlItems = await provider.read({ root: TEST_ROOT, format: 'jsonl', fields: FIELDS });
    const csvItems = await provider.read({ root: TEST_ROOT, format: 'csv', fields: FIELDS });
    for (const item of [...jsonlItems, ...csvItems]) {
      assert.ok(item._trust);
      assert.equal(item._trust.level, TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED);
      assert.equal(typeof item._trust.source, 'string');
      assert.equal(typeof item._trust.stampedAt, 'number');
    }
  });
});

describe('feedback provider — search', () => {
  before(() => setupFixtures());
  after(() => teardownFixtures());

  const provider = create();

  it('finds matching feedback text (case-insensitive)', async () => {
    const results = await provider.search({ root: TEST_ROOT, format: 'jsonl', fields: FIELDS }, 'checkout');
    assert.ok(Array.isArray(results));
    assert.ok(results.length >= 1);
    assert.ok(results.every((r) => r.text.toLowerCase().includes('checkout')));
  });

  it('returns empty array when nothing matches', async () => {
    const results = await provider.search({ root: TEST_ROOT, format: 'jsonl', fields: FIELDS }, 'zzz-no-match-zzz');
    assert.deepEqual(results, []);
  });

  it('throws when query is not provided', async () => {
    await assert.rejects(
      () => provider.search({ root: TEST_ROOT, format: 'jsonl', fields: FIELDS }, ''),
      /query required/
    );
  });
});

describe('feedback provider — config validation', () => {
  before(() => setupFixtures());
  after(() => teardownFixtures());

  const provider = create();

  it('throws when root is not configured', async () => {
    await assert.rejects(() => provider.read({ format: 'jsonl', fields: FIELDS }), /root/);
  });

  it('throws when format is missing or invalid', async () => {
    await assert.rejects(
      () => provider.read({ root: TEST_ROOT, format: 'xml', fields: FIELDS }),
      /format must be 'jsonl' or 'csv'/
    );
  });

  it('throws when fields.id or fields.text are missing', async () => {
    await assert.rejects(
      () => provider.read({ root: TEST_ROOT, format: 'jsonl', fields: { author: 'author' } }),
      /fields\.id and config\.fields\.text are required/
    );
  });
});

describe('feedback provider — manifest-driven registration (zero central dispatch edits)', () => {
  before(() => setupFixtures());
  after(() => teardownFixtures());

  it('resolveProviders() discovers feedback purely from lib/extensions/manifests/feedback.manifest.json', async () => {
    const { providers, errors } = await resolveProviders();
    assert.deepEqual(errors, [], 'provider resolution should produce no errors');
    assert.ok(providers.feedback, 'resolveProviders should include feedback');
    assert.equal(providers.feedback.meta.id, 'feedback');
    assert.deepEqual(providers.feedback.meta.capabilities, ['read', 'search']);
  });
});
