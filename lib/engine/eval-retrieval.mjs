/**
 * lib/engine/eval-retrieval.mjs — Retrieval-quality evaluation harness.
 *
 * Runs a fixed query set against a corpus through the engine's retrieval
 * pipeline (BM25 + cosine → RRF fuse → MMR rerank, with whatever plugins
 * are active) and reports standard IR metrics:
 *
 *   - Recall@k     fraction of expected docs that appear in the top-k
 *   - MRR          mean reciprocal rank of the first expected doc
 *   - NDCG@k       discounted cumulative gain over the top-k
 *
 * The harness is corpus-agnostic — callers pass in chunks (each with id,
 * title, body) and a list of queries with expected doc ids. The pipeline
 * itself is the same one `lib/knowledge/rag.mjs::retrieve` uses, so any
 * plugin swap (Fuser, Reranker, etc.) is reflected in the metrics.
 *
 * The CLI surface (`construct evals retrieval`) loads a fixture file
 * shipped at `config/evals/retrieval-queries.json` against an inline
 * mini-corpus, but callers can also provide their own datasets.
 */

import { readFileSync } from 'node:fs';
import { rankByBm25, cosineSimilarity } from '../storage/embeddings.mjs';
import { embedSync } from '../storage/embeddings-legacy.mjs';
import { getEngine } from './index.mjs';

function buildEmbeddedCorpus(chunks) {
  return chunks.map((c) => ({
    ...c,
    embedding: embedSync(`${c.title || ''} ${c.body || ''}`),
  }));
}

async function retrieveOne(query, corpus, engine, topK) {
  const queryEmbedding = embedSync(query);
  const bm25Ranked = rankByBm25(
    corpus.map((c) => ({ ...c, text: `${c.title || ''} ${c.body || ''}` })),
    query,
    { limit: corpus.length },
  );
  const cosineRanked = corpus
    .map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding || []),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const fused = engine.layers.fuser.fuse({ bm25: bm25Ranked, cosine: cosineRanked });
  const reranked = await engine.layers.reranker.rerank(query, fused, {
    queryEmbedding,
    topK,
  });
  return reranked;
}

function recallAt(ranked, expectedIds, k) {
  const top = new Set(ranked.slice(0, k).map((r) => r.id));
  let hits = 0;
  for (const id of expectedIds) if (top.has(id)) hits++;
  return expectedIds.length === 0 ? 0 : hits / expectedIds.length;
}

function reciprocalRank(ranked, expectedIds) {
  for (let i = 0; i < ranked.length; i++) {
    if (expectedIds.includes(ranked[i].id)) return 1 / (i + 1);
  }
  return 0;
}

function ndcgAt(ranked, expectedIds, k) {
  const expected = new Set(expectedIds);
  let dcg = 0;
  for (let i = 0; i < Math.min(k, ranked.length); i++) {
    if (expected.has(ranked[i].id)) {
      dcg += 1 / Math.log2(i + 2);
    }
  }
  let idcg = 0;
  for (let i = 0; i < Math.min(k, expectedIds.length); i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg === 0 ? 0 : dcg / idcg;
}

/**
 * Run the evaluation. Returns aggregate metrics + a per-query breakdown.
 *
 * @param {object} args
 * @param {Array<{ id, title, body }>} args.corpus
 * @param {Array<{ query, expected: string[] }>} args.queries
 * @param {object} [args.engine] — pre-resolved engine (for tests)
 * @param {number} [args.topK=5]
 * @returns {Promise<{
 *   recallAt1, recallAt5, mrr, ndcgAt5,
 *   queries: Array<{ query, expected, ranked: string[], recallAt1, recallAt5, mrr, ndcgAt5 }>,
 * }>}
 */
export async function evaluateRetrieval({ corpus, queries, engine, topK = 5 }) {
  const eng = engine || (await getEngine());
  const embedded = buildEmbeddedCorpus(corpus);

  const results = [];
  for (const { query, expected } of queries) {
    const ranked = await retrieveOne(query, embedded, eng, Math.max(topK, 5));
    results.push({
      query,
      expected,
      ranked: ranked.slice(0, topK).map((r) => r.id),
      recallAt1: recallAt(ranked, expected, 1),
      recallAt5: recallAt(ranked, expected, 5),
      mrr: reciprocalRank(ranked, expected),
      ndcgAt5: ndcgAt(ranked, expected, 5),
    });
  }

  const mean = (key) => results.reduce((acc, r) => acc + r[key], 0) / Math.max(results.length, 1);

  return {
    queryCount: results.length,
    corpusSize: corpus.length,
    recallAt1: mean('recallAt1'),
    recallAt5: mean('recallAt5'),
    mrr: mean('mrr'),
    ndcgAt5: mean('ndcgAt5'),
    queries: results,
  };
}

/**
 * Convenience: load a JSON fixture { corpus, queries } from disk and run.
 */
export async function evaluateFixture(fixturePath, opts = {}) {
  let raw;
  try {
    raw = readFileSync(fixturePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Retrieval eval fixture not found: ${fixturePath}\nCheck the --fixture= path — it must point to a JSON file with { corpus, queries }.`);
    }
    throw err;
  }
  const data = JSON.parse(raw);
  return evaluateRetrieval({ ...data, ...opts });
}

export function formatReport(report) {
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const lines = [
    `Corpus: ${report.corpusSize} chunks · Queries: ${report.queryCount}`,
    `Recall@1:  ${pct(report.recallAt1)}`,
    `Recall@5:  ${pct(report.recallAt5)}`,
    `MRR:       ${report.mrr.toFixed(3)}`,
    `NDCG@5:    ${report.ndcgAt5.toFixed(3)}`,
  ];
  return lines.join('\n');
}
