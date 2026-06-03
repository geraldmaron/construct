/**
 * tests/ingest-provider-extract.test.mjs — provider-backed extraction unit tests.
 *
 * Exercises the concrete provider route with a mocked fetch (no live key): text
 * files post inline content, images post a multimodal block, the OpenRouter vs
 * Anthropic API is selected from the model, and unsupported media (audio/video,
 * Office) plus missing keys and HTTP errors raise specific structured codes
 * rather than the old blanket PROVIDER_EXTRACTION_UNWIRED.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { extractViaProvider } from '../lib/ingest/provider-extract.mjs';

const tmpDirs = [];
function fixture(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-provx-'));
  tmpDirs.push(dir);
  const full = path.join(dir, name);
  fs.writeFileSync(full, content);
  return full;
}
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function okFetch(captured, payload) {
  return async (url, init) => {
    captured.url = url;
    captured.body = JSON.parse(init.body);
    captured.headers = init.headers;
    return { ok: true, json: async () => payload };
  };
}

test('text file via OpenRouter posts inline content and returns the model output', async () => {
  const captured = {};
  const r = await extractViaProvider({
    filePath: fixture('a.txt', 'hello source'),
    model: 'openai/gpt-4o-mini',
    provider: 'openrouter',
    env: { OPENROUTER_API_KEY: 'sk-or' },
    fetchImpl: okFetch(captured, { choices: [{ message: { content: 'CLEANED TEXT' } }] }),
  });
  assert.equal(r.text, 'CLEANED TEXT');
  assert.equal(r.extractionMethod, 'provider:openrouter:openai/gpt-4o-mini');
  assert.match(captured.url, /openrouter\.ai/);
  assert.match(String(captured.body.messages[0].content), /hello source/);
});

test('claude-family model routes to the Anthropic messages API', async () => {
  const captured = {};
  const r = await extractViaProvider({
    filePath: fixture('a.txt', 'hi'),
    model: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    env: { ANTHROPIC_API_KEY: 'sk-ant' },
    fetchImpl: okFetch(captured, { content: [{ type: 'text', text: 'ANTHROPIC OUT' }] }),
  });
  assert.equal(r.text, 'ANTHROPIC OUT');
  assert.match(r.extractionMethod, /^provider:anthropic:/);
  assert.match(captured.url, /api\.anthropic\.com/);
  assert.equal(captured.headers['x-api-key'], 'sk-ant');
});

test('image file posts a multimodal image_url block on OpenRouter', async () => {
  const captured = {};
  const pngBytes = Buffer.from('89504e470d0a1a0a', 'hex');
  const img = fixture('shot.png', pngBytes);
  await extractViaProvider({
    filePath: img,
    model: 'openai/gpt-4o',
    provider: 'openrouter',
    env: { OPENROUTER_API_KEY: 'sk-or' },
    fetchImpl: okFetch(captured, { choices: [{ message: { content: 'ocr text' } }] }),
  });
  const block = captured.body.messages[0].content.find((c) => c.type === 'image_url');
  assert.ok(block, 'an image_url block is sent');
  assert.match(block.image_url.url, /^data:image\/png;base64,/);
});

test('maxChars truncates the returned text', async () => {
  const r = await extractViaProvider({
    filePath: fixture('a.txt', 'x'),
    model: 'm',
    provider: 'openrouter',
    maxChars: 4,
    env: { OPENROUTER_API_KEY: 'sk-or' },
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'abcdefgh' } }] }) }),
  });
  assert.equal(r.text, 'abcd');
  assert.equal(r.truncated, true);
});

test('audio/video raises PROVIDER_MEDIA_UNSUPPORTED', async () => {
  await assert.rejects(
    () => extractViaProvider({ filePath: fixture('clip.mp3', 'bytes'), model: 'm', provider: 'openrouter', env: { OPENROUTER_API_KEY: 'k' }, fetchImpl: async () => ({}) }),
    (e) => e.code === 'PROVIDER_MEDIA_UNSUPPORTED',
  );
});

test('Office/zip docs raise PROVIDER_MEDIA_UNSUPPORTED', async () => {
  await assert.rejects(
    () => extractViaProvider({ filePath: fixture('deck.pptx', 'bytes'), model: 'm', provider: 'openrouter', env: { OPENROUTER_API_KEY: 'k' }, fetchImpl: async () => ({}) }),
    (e) => e.code === 'PROVIDER_MEDIA_UNSUPPORTED',
  );
});

test('PDF via a non-Anthropic provider raises PROVIDER_MEDIA_UNSUPPORTED', async () => {
  await assert.rejects(
    () => extractViaProvider({ filePath: fixture('doc.pdf', '%PDF-1.4'), model: 'openai/gpt-4o', provider: 'openrouter', env: { OPENROUTER_API_KEY: 'k' }, fetchImpl: async () => ({}) }),
    (e) => e.code === 'PROVIDER_MEDIA_UNSUPPORTED',
  );
});

test('PDF via an Anthropic model posts a document block', async () => {
  const captured = {};
  await extractViaProvider({
    filePath: fixture('doc.pdf', '%PDF-1.4 minimal'),
    model: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    env: { ANTHROPIC_API_KEY: 'sk-ant' },
    fetchImpl: okFetch(captured, { content: [{ type: 'text', text: 'pdf text' }] }),
  });
  const block = captured.body.messages[0].content.find((c) => c.type === 'document');
  assert.ok(block, 'a document block is sent');
  assert.equal(block.source.media_type, 'application/pdf');
});

test('a missing key raises PROVIDER_KEY_MISSING (hermetic with explicit env)', async () => {
  await assert.rejects(
    () => extractViaProvider({ filePath: fixture('a.txt', 'x'), model: 'm', provider: 'openrouter', env: {}, fetchImpl: async () => ({}) }),
    (e) => e.code === 'PROVIDER_KEY_MISSING',
  );
});

test('an unresolved model raises PROVIDER_MODEL_UNRESOLVED', async () => {
  await assert.rejects(
    () => extractViaProvider({ filePath: fixture('a.txt', 'x'), model: null, env: {}, fetchImpl: async () => ({}) }),
    (e) => e.code === 'PROVIDER_MODEL_UNRESOLVED',
  );
});

test('a provider HTTP error raises PROVIDER_EXTRACTION_FAILED', async () => {
  await assert.rejects(
    () => extractViaProvider({
      filePath: fixture('a.txt', 'x'),
      model: 'm',
      provider: 'openrouter',
      env: { OPENROUTER_API_KEY: 'k' },
      fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'rate limited' }),
    }),
    (e) => e.code === 'PROVIDER_EXTRACTION_FAILED' && /429/.test(e.message),
  );
});
