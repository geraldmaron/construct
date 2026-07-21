#!/usr/bin/env node
/**
 * lib/storage/embeddings.mjs — Pure scoring & tokenization utilities.
 *
 * Holds the model-agnostic primitives only:
 *   tokenize, cosineSimilarity, bm25Score, buildTermFrequencies,
 *   buildIdf, rankByBm25, scoreByEmbedding.
 *
 * Embedding adapters live alongside the engine (lib/storage/embeddings-engine.mjs
 * and per-model files like embeddings-local.mjs / embeddings-openai.mjs /
 * embeddings-hashing.mjs). Callers obtain embeddings via the engine. Anything
 * reaching for a hashing fallback should call `embeddings-hashing.mjs::embed`
 * directly or set CONSTRUCT_EMBEDDING_MODEL=hashing.
 */

const BM25_K1 = 1.5;
const BM25_B = 0.75;

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2);
}

export function cosineSimilarity(left = [], right = []) {
  const length = Math.min(left.length, right.length);
  if (length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < length; i += 1) {
    const lv = Number(left[i] || 0);
    const rv = Number(right[i] || 0);
    dot += lv * rv;
    leftNorm += lv * lv;
    rightNorm += rv * rv;
  }
  const denom = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denom > 0 ? dot / denom : 0;
}

/**
 * BM25 score for a single document against a query.
 * documents — array of tokenized term-frequency maps built by buildTermFrequencies().
 * avgDocLen — average document length across the corpus.
 * idf — Map<term, number> built by buildIdf().
 */
export function bm25Score(queryTerms, docTerms, docLen, avgDocLen, idf) {
  let score = 0;
  for (const term of queryTerms) {
    const tf = docTerms.get(term) || 0;
    if (tf === 0) continue;
    const idfVal = idf.get(term) || 0;
    const tfNorm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * docLen / Math.max(avgDocLen, 1)));
    score += idfVal * tfNorm;
  }
  return score;
}

export function buildTermFrequencies(text) {
  const tf = new Map();
  for (const term of tokenize(text)) {
    tf.set(term, (tf.get(term) || 0) + 1);
  }
  return tf;
}

/**
 * Build IDF values for a corpus of term-frequency maps.
 * Returns Map<term, idf_value> using the Robertson-Sparck Jones variant.
 */
export function buildIdf(corpus) {
  const N = corpus.length;
  const docFreq = new Map();
  for (const tfMap of corpus) {
    for (const term of tfMap.keys()) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }
  const idf = new Map();
  for (const [term, df] of docFreq) {
    idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
  }
  return idf;
}

/**
 * Rank documents by cosine similarity against a pre-computed query embedding.
 * Decouples scoring from the embedding model — callers obtain the query
 * embedding via the configured engine, then pass it here to score documents
 * that already carry an `embedding` field of the same dimension.
 */
export function scoreByEmbedding(documents = [], queryEmbedding = [], { limit = 10 } = {}) {
  return documents
    .map((document) => ({
      document,
      score: cosineSimilarity(queryEmbedding, document.embedding || []),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || String(a.document.id || '').localeCompare(String(b.document.id || '')))
    .slice(0, limit)
    .map(({ document, score }) => ({ ...document, score }));
}

export function rankByBm25(documents, query, { limit = 10 } = {}) {
  if (!query || documents.length === 0) return [];
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const tfMaps = documents.map((doc) => {
    const text = [doc.text, doc.body, doc.summary, doc.content, doc.title].filter(Boolean).join(' ');
    return buildTermFrequencies(text);
  });

  const totalLen = tfMaps.reduce((sum, tf) => sum + [...tf.values()].reduce((a, b) => a + b, 0), 0);
  const avgDocLen = totalLen / Math.max(tfMaps.length, 1);
  const idf = buildIdf(tfMaps);

  return documents
    .map((doc, i) => {
      const docLen = [...tfMaps[i].values()].reduce((a, b) => a + b, 0);
      const score = bm25Score(queryTerms, tfMaps[i], docLen, avgDocLen, idf);
      return { ...doc, score };
    })
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
