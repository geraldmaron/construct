/**
 * tests/functional/hybrid-search-consolidated.functional.test.mjs
 *
 * The one consolidated hybrid path against real pgvector: file BM25 + native
 * HNSW ANN (`<=>`, with hnsw.iterative_scan on pgvector >= 0.8) + keyword,
 * fused by Reciprocal Rank Fusion. A document matched by BOTH keyword and vector
 * ranks above one matched by a single signal (RRF agreement), and the run sets
 * iterative_scan when the extension supports it. A deterministic fake 384-dim
 * embedder keeps the test fast.
 *
 * Skips when Docker isn't available (withPostgres returns null).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPostgres } from './_lib/postgres-docker.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function fakeEmbed(text) {
  const v = new Float32Array(384);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h = Math.imul(h ^ text.charCodeAt(i), 16777619); }
  for (let i = 0; i < 384; i += 1) { h = Math.imul(h ^ i, 16777619); v[i] = ((h >>> 0) % 1000) / 1000; }
  return { embedding: v, model: 'test-model', dimensions: 384 };
}

test('consolidated hybrid search fuses BM25 + ANN + keyword via RRF over pgvector', async (t) => {
  const pg = await withPostgres(t);
  if (!pg) return;

  const { floatArrayToPgVector } = await import(join(REPO_ROOT, 'lib', 'storage', 'vector-client.mjs'));
  const docs = [
    { id: 'd1', title: 'alpha document', body: 'alpha body' },
    { id: 'd2', title: 'beta document', body: 'beta body' },
    { id: 'd3', title: 'gamma notes', body: 'gamma body' },
  ];
  for (const d of docs) {
    await pg.client`INSERT INTO construct_documents (id, project, kind, title, summary, body, source_path, tags, content_hash)
      VALUES (${d.id}, 'construct', 'knowledge', ${d.title}, ${d.title}, ${d.body}, ${`docs/${d.id}.md`}, '[]'::jsonb, ${`h-${d.id}`})`;
    await pg.client`INSERT INTO construct_embeddings (document_id, model, embedding, content_hash)
      VALUES (${d.id}, 'test-model', ${floatArrayToPgVector(fakeEmbed(`${d.title} ${d.body}`).embedding)}, ${`h-${d.id}`})`;
  }

  const prev = process.env.DATABASE_URL;
  process.env.DATABASE_URL = pg.url;
  t.after(() => { if (prev !== undefined) process.env.DATABASE_URL = prev; else delete process.env.DATABASE_URL; });

  const root = mkdtempSync(join(tmpdir(), 'hyb-fn-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

  const { buildHybridSearchResultsAsync } = await import(join(REPO_ROOT, 'lib', 'storage', 'hybrid-query.mjs'));
  const res = await buildHybridSearchResultsAsync(root, 'alpha', {
    limit: 5, embed: async (text) => fakeEmbed(text), embeddingModel: 'test-model',
  });

  assert.ok(!res.error, `search errored: ${res.error}`);
  assert.equal(res.stores.vector.iterativeScan, true, 'iterative_scan is enabled on pgvector >= 0.8');
  assert.ok(res.results.length >= 1, 'results are returned');
  assert.equal(res.results[0].id, 'd1', 'the keyword+vector match ranks first via RRF agreement');
  assert.ok(res.results.every((r) => typeof r.score === 'number'), 'every result carries a fused score');
});
