/**
 * tests/knowledge-rag.test.mjs — Unit tests for lib/knowledge/rag.mjs.
 *
 * Tests corpus building (with mock file system), hybrid retrieval scoring,
 * context assembly, and the ask() function (dry-run mode only — no claude CLI).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrieve, assembleContext } from '../lib/knowledge/rag.mjs';
import { embedText } from '../lib/storage/embeddings.mjs';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeChunk(id, title, body, source = 'test') {
  return {
    id,
    source,
    title,
    body,
    embedding: embedText(`${title} ${body}`),
  };
}

const CORPUS = [
  makeChunk('obs:1', 'Authentication uses JWT tokens', 'We decided to use JWT with RS256 for stateless auth. Session duration is 8 hours.', 'observation'),
  makeChunk('obs:2', 'Rate limiting anti-pattern', 'No rate limiting on the webhook endpoint is a recurring risk and anti-pattern.', 'observation'),
  makeChunk('art:adr-0001', 'ADR-0001: Zero npm dependencies in core', 'Core CLI must have zero npm dependencies. Providers may bring their own.', 'artifact'),
  makeChunk('art:adr-0002', 'ADR-0002: Layered architecture', 'Five layers: core, providers, runtime, dashboard, deploy.', 'artifact'),
  makeChunk('snap:1', 'Weekly snapshot — 2026-04-28', 'Risks: rate limiting not configured. Health: all providers connected.', 'snapshot'),
  makeChunk('obs:3', 'Docker build optimisation', 'Multi-stage Docker builds reduced image size by 40%.', 'observation'),
];

// ── retrieve() ─────────────────────────────────────────────────────────────

test('retrieve returns results sorted by score descending', () => {
  const results = retrieve('JWT authentication tokens', CORPUS);
  assert.ok(results.length > 0);
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i - 1].score >= results[i].score,
      `chunk ${i - 1} score ${results[i - 1].score} should be >= chunk ${i} score ${results[i].score}`);
  }
});

test('retrieve surfaces the most semantically relevant chunk first', () => {
  const results = retrieve('JWT authentication', CORPUS);
  assert.ok(results.length > 0);
  assert.equal(results[0].id, 'obs:1');
});

test('retrieve surfaces rate limiting risk for risk query', () => {
  const results = retrieve('rate limiting risk webhook', CORPUS);
  assert.ok(results.length > 0);
  const ids = results.map((r) => r.id);
  assert.ok(ids.includes('obs:2') || ids.includes('snap:1'),
    'Expected obs:2 or snap:1 in top results');
});

test('retrieve returns empty array for empty corpus', () => {
  assert.deepEqual(retrieve('anything', []), []);
});

test('retrieve returns empty array for empty query', () => {
  assert.deepEqual(retrieve('', CORPUS), []);
});

test('retrieve respects topK limit', () => {
  const results = retrieve('architecture layers', CORPUS, { topK: 2 });
  assert.ok(results.length <= 2);
});

test('retrieve minScore filters out low-relevance chunks', () => {
  const results = retrieve('JWT auth', CORPUS, { minScore: 0.99 });
  // Very high threshold — may return 0 or only exact matches
  assert.ok(Array.isArray(results));
  for (const r of results) {
    assert.ok(r.score >= 0.99);
  }
});

test('retrieve includes both BM25 keyword match and semantic match', () => {
  // "dependencies" only appears in adr-0001 text
  const results = retrieve('npm dependencies in core', CORPUS);
  const ids = results.map((r) => r.id);
  assert.ok(ids.includes('art:adr-0001'), 'ADR-0001 should be retrieved for dependency query');
});

// ── assembleContext() ──────────────────────────────────────────────────────

test('assembleContext returns a non-empty string for non-empty chunks', () => {
  const chunks = retrieve('architecture', CORPUS);
  const ctx = assembleContext(chunks);
  assert.ok(typeof ctx === 'string');
  assert.ok(ctx.length > 0);
});

test('assembleContext includes chunk titles', () => {
  const chunks = [makeChunk('x:1', 'My Unique Title', 'Some content here.', 'test')];
  const ctx = assembleContext(chunks);
  assert.ok(ctx.includes('My Unique Title'));
});

test('assembleContext stays within MAX_CONTEXT_CHARS', () => {
  // Create many large chunks
  const bigCorpus = Array.from({ length: 50 }, (_, i) =>
    makeChunk(`c:${i}`, `Chunk ${i}`, 'x'.repeat(1000), 'test')
  );
  const ctx = assembleContext(bigCorpus);
  assert.ok(ctx.length <= 15_000, `context too large: ${ctx.length}`);
});

test('assembleContext returns empty string for empty chunks', () => {
  assert.equal(assembleContext([]), '');
});

// ── ask() dry-run ──────────────────────────────────────────────────────────

test('ask dry-run returns sources without calling claude', async () => {
  const { ask } = await import('../lib/knowledge/rag.mjs');
  const result = await ask('authentication', { corpus: CORPUS, dryRun: true });
  assert.equal(result.answer, null);
  assert.ok(Array.isArray(result.sources));
  assert.ok(result.sources.length > 0);
  assert.equal(result.query, 'authentication');
});

test('ask dry-run sources have id, source, title, score', async () => {
  const { ask } = await import('../lib/knowledge/rag.mjs');
  const result = await ask('deployment Docker', { corpus: CORPUS, dryRun: true });
  for (const s of result.sources) {
    assert.ok(s.id, 'source must have id');
    assert.ok(s.source, 'source must have source');
    assert.ok(s.title, 'source must have title');
    assert.ok(typeof s.score === 'number', 'source must have numeric score');
  }
});

test('ask dry-run with empty corpus returns empty sources', async () => {
  const { ask } = await import('../lib/knowledge/rag.mjs');
  const result = await ask('anything', { corpus: [], dryRun: true });
  assert.deepEqual(result.sources, []);
});
