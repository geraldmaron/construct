/**
 * Vector roundtrip — write a small corpus into pgvector, then query it
 * directly via Postgres and assert the cosine-distance ranking returns the
 * expected nearest neighbor. This verifies the storage layer Construct's
 * runtime depends on for hybrid retrieval.
 *
 * Skips when Docker isn't available.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { withPostgres } from './_lib/postgres-docker.mjs';

// Tiny deterministic "embeddings" — orthogonal-ish 8-dimensional unit vectors.
// Real embeddings would come from the embedder; we don't need that for the
// storage-layer assertion.

const CORPUS = [
  { id: 'a', text: 'authentication and login', emb: [1, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'b', text: 'database migrations',       emb: [0, 1, 0, 0, 0, 0, 0, 0] },
  { id: 'c', text: 'payment processing',        emb: [0, 0, 1, 0, 0, 0, 0, 0] },
  { id: 'd', text: 'auth and session tokens',   emb: [0.9, 0.1, 0, 0, 0, 0, 0, 0] },
];

const QUERY_EMB = [1, 0, 0, 0, 0, 0, 0, 0];

function fmtVec(v) { return `[${v.join(',')}]`; }

test('Hybrid corpus inserts + cosine-distance ranking returns expected top-k', async (t) => {
  const pg = await withPostgres(t);
  if (!pg) return;

  await pg.client`
    CREATE TABLE corpus_smoke (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      embedding vector(8) NOT NULL
    )
  `;
  for (const item of CORPUS) {
    await pg.client`INSERT INTO corpus_smoke (id, text, embedding) VALUES (${item.id}, ${item.text}, ${fmtVec(item.emb)})`;
  }

  const ranked = await pg.client`
    SELECT id, text, embedding <=> ${fmtVec(QUERY_EMB)} AS distance
    FROM corpus_smoke
    ORDER BY distance ASC
    LIMIT 3
  `;

  assert.equal(ranked.length, 3, 'top-3 must return 3 rows');
  assert.equal(ranked[0].id, 'a', `nearest neighbor must be the identical embedding; got ${ranked[0].id}`);
  assert.equal(ranked[1].id, 'd', `second-nearest must be the close auth-related embedding; got ${ranked[1].id}`);
  assert.notEqual(ranked[2].id, 'a');
  assert.notEqual(ranked[2].id, 'd');
});

test('IVFFlat index can be built and queried over the corpus', async (t) => {
  const pg = await withPostgres(t);
  if (!pg) return;

  await pg.client`
    CREATE TABLE corpus_index_smoke (
      id TEXT PRIMARY KEY,
      embedding vector(8) NOT NULL
    )
  `;
  for (const item of CORPUS) {
    await pg.client`INSERT INTO corpus_index_smoke (id, embedding) VALUES (${item.id}, ${fmtVec(item.emb)})`;
  }

  // IVFFlat requires lists >= 1 and recommends sqrt(rows); use 2 for a tiny
  // smoke. The index creates successfully even on a small corpus.

  await pg.client`CREATE INDEX corpus_idx ON corpus_index_smoke USING ivfflat (embedding vector_cosine_ops) WITH (lists = 2)`;
  await pg.client`ANALYZE corpus_index_smoke`;

  const indexes = await pg.client`SELECT indexname FROM pg_indexes WHERE tablename = 'corpus_index_smoke'`;
  const names = indexes.map((i) => i.indexname);
  assert.ok(names.includes('corpus_idx'), `expected corpus_idx, got ${names.join(', ')}`);

  const ranked = await pg.client`
    SELECT id FROM corpus_index_smoke
    ORDER BY embedding <=> ${fmtVec(QUERY_EMB)} ASC
    LIMIT 1
  `;
  assert.equal(ranked[0].id, 'a');
});
