/**
 * tests/model-pricing.test.mjs — pricing resolution for local/static/OpenRouter ids.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { getPricingForModels, formatPricingLabel } from '../lib/model-pricing.mjs';

function mockFetch(payload, { ok = true } = {}) {
  return async () => ({ ok, json: async () => payload });
}

let cacheDir;
let cacheFile;
beforeEach(() => {
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-pricing-cache-'));
  cacheFile = path.join(cacheDir, 'model-pricing.json');
});
afterEach(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

describe('getPricingForModels', () => {
  it('returns zero pricing for ollama models without a network call', async () => {
    let called = false;
    const result = await getPricingForModels(['ollama/llama3.1:70b'], { fetchImpl: () => { called = true; throw new Error('should not fetch'); }, cacheFile });
    assert.equal(called, false);
    const entry = result['ollama/llama3.1:70b'];
    assert.equal(entry.input, 0);
    assert.equal(entry.output, 0);
    assert.equal(entry.source, 'local');
  });

  it('returns zero pricing for local/* models', async () => {
    const result = await getPricingForModels(['local/custom-large'], { cacheFile });
    assert.equal(result['local/custom-large'].source, 'local');
  });

  it('uses the static table for anthropic/openai direct ids', async () => {
    const result = await getPricingForModels(['anthropic/claude-sonnet-4-6'], { cacheFile });
    const entry = result['anthropic/claude-sonnet-4-6'];
    assert.equal(entry.source, 'static');
    assert.equal(entry.input, 3);
    assert.equal(entry.output, 15);
  });

  it('hits OpenRouter for openrouter/* ids and normalises per 1M', async () => {
    const fakeCatalog = {
      data: [
        { id: 'foo/bar', pricing: { prompt: '0.000002', completion: '0.000008' }, context_length: 8000 },
      ],
    };
    const result = await getPricingForModels(['openrouter/foo/bar'], {
      fetchImpl: mockFetch(fakeCatalog),
      cacheFile,
    });
    const entry = result['openrouter/foo/bar'];
    assert.ok(entry);
    assert.equal(entry.input, 2);
    assert.equal(entry.output, 8);
    assert.equal(entry.source, 'openrouter');
    assert.equal(entry.context, 8000);
  });

  it('returns null for openrouter ids not present in the catalog', async () => {
    const result = await getPricingForModels(['openrouter/missing/model'], {
      fetchImpl: mockFetch({ data: [] }),
      cacheFile,
    });
    assert.equal(result['openrouter/missing/model'], null);
  });

  it('treats future-timestamped caches as stale (clock-skew defence)', async () => {
    fs.writeFileSync(cacheFile, JSON.stringify({
      fetchedAt: Date.now() + 24 * 60 * 60 * 1000,
      models: { 'openrouter/stale/value': { input: 99, output: 99 } },
    }));
    const fakeCatalog = { data: [{ id: 'fresh/value', pricing: { prompt: '0.000001', completion: '0.000003' } }] };
    const result = await getPricingForModels(['openrouter/fresh/value'], { fetchImpl: mockFetch(fakeCatalog), cacheFile });
    assert.ok(result['openrouter/fresh/value']);
    assert.equal(result['openrouter/fresh/value'].input, 1);
  });
});

describe('formatPricingLabel', () => {
  it('renders the local label for local providers', () => {
    assert.equal(formatPricingLabel({ source: 'local', input: 0, output: 0, label: 'free · runs locally' }), 'free · runs locally');
  });

  it('formats USD per 1M for priced models', () => {
    assert.equal(formatPricingLabel({ input: 3, output: 15 }), '$3.00 in · $15.00 out / 1M');
  });

  it('returns null for missing pricing', () => {
    assert.equal(formatPricingLabel(null), null);
  });
});
