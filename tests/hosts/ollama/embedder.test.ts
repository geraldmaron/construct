/**
 * tests/hosts/ollama/embedder.test.ts — construct-2jb.12.
 *
 * fetch is stubbed throughout: these tests pin the HTTP contract and the
 * domain-vector caching behavior, not live ollama availability (that is
 * scripts/measure-decisions.mjs --embeddings's job, against a real model).
 * Nothing here touches env, home, or the filesystem, so the sterile harness
 * is not needed — there is nothing ambient to leak.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaEmbedder, withDomainCache } from '../../../src/hosts/ollama/embedder.ts';
import { domainText } from '../../../src/kernel/implication/similarity.ts';
import type { Embedder } from '../../../src/kernel/implication/similarity.ts';
import type { Domain } from '../../../src/kernel/implication/domains.ts';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

test('createOllamaEmbedder posts to /api/embeddings with the configured model', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return jsonResponse({ embedding: [1, 2, 3] });
  };
  const embedder = createOllamaEmbedder({
    baseUrl: 'http://example.invalid',
    model: 'a-model',
    fetchImpl,
  });
  const vec = await embedder('hello world');
  assert.deepEqual(vec, [1, 2, 3]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'http://example.invalid/api/embeddings');
  assert.deepEqual(calls[0]!.body, { model: 'a-model', prompt: 'hello world' });
});

test('defaults point at the local ollama server and nomic-embed-text', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({ embedding: [1] });
  };
  const embedder = createOllamaEmbedder({ fetchImpl });
  await embedder('x');
  assert.equal(calls[0], 'http://127.0.0.1:11434/api/embeddings');
});

test('a non-OK response throws rather than returning a fabricated vector', async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse({}, false, 503);
  const embedder = createOllamaEmbedder({ fetchImpl });
  await assert.rejects(embedder('x'), /503/);
});

test('a response with no embedding array throws rather than returning undefined', async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse({ nope: true });
  const embedder = createOllamaEmbedder({ fetchImpl });
  await assert.rejects(embedder('x'), /embedding/);
});

const CATALOG: readonly Domain[] = [
  { path: 'privacy', domain: 'privacy', concern: 'personal data and consent', keywords: [] },
  { path: 'security', domain: 'security', concern: 'who can reach what', keywords: [] },
];

test('withDomainCache calls the underlying embedder once per domain, no matter how many outcomes ask', async () => {
  const calls: string[] = [];
  const inner: Embedder = async (text) => {
    calls.push(text);
    return [1];
  };
  const cached = withDomainCache(inner, CATALOG);

  await cached(domainText(CATALOG[0]!));
  await cached(domainText(CATALOG[1]!));
  await cached(domainText(CATALOG[0]!));
  await cached(domainText(CATALOG[1]!));

  assert.deepEqual(calls, [domainText(CATALOG[0]!), domainText(CATALOG[1]!)]);
});

test('withDomainCache never caches outcome text, only catalog domain text', async () => {
  const calls: string[] = [];
  const inner: Embedder = async (text) => {
    calls.push(text);
    return [1];
  };
  const cached = withDomainCache(inner, CATALOG);

  await cached('an outcome');
  await cached('an outcome');
  await cached('an outcome');

  assert.deepEqual(calls, ['an outcome', 'an outcome', 'an outcome']);
});

test('withDomainCache passes through the real vector unchanged', async () => {
  const inner: Embedder = async (text) => (text === domainText(CATALOG[0]!) ? [1, 2, 3] : [9]);
  const cached = withDomainCache(inner, CATALOG);
  assert.deepEqual(await cached(domainText(CATALOG[0]!)), [1, 2, 3]);
});
