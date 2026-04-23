#!/usr/bin/env node
/**
 * lib/storage/embeddings.mjs — deterministic local embeddings + BM25 keyword scoring.
 *
 * Two complementary scorers:
 *   embedText / cosineSimilarity — hashing bag-of-words for vector indexing.
 *   bm25Score — term-frequency / inverse-document-frequency ranking for short-text recall.
 *     Better than cosine for exact-keyword queries; no stemming, no external deps.
 */
import crypto from 'node:crypto';

export const EMBEDDING_MODEL = 'hashing-bow-v1';
export const EMBEDDING_DIMENSIONS = 256;

// BM25 tuning parameters
const BM25_K1 = 1.5; // term saturation (higher = more weight to repeated terms)
const BM25_B = 0.75; // length normalization (1 = full normalization)

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2); // lowered from 3 to retain two-char tokens (e.g. "ts", "cx")
}

function bucketForToken(token, dimensions) {
  const hash = crypto.createHash('sha256').update(token).digest();
  return hash.readUInt32BE(0) % dimensions;
}

function signForToken(token) {
  const hash = crypto.createHash('sha256').update(token).digest();
  return (hash[4] & 1) === 0 ? 1 : -1;
}

export function embedText(text, dimensions = EMBEDDING_DIMENSIONS) {
  const vector = new Array(dimensions).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) return vector;

  for (const token of tokens) {
    const bucket = bucketForToken(token, dimensions);
    vector[bucket] += signForToken(token);
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
  if (norm === 0) return vector;
  return vector.map((value) => Number((value / norm).toFixed(8)));
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

/**
 * Build term-frequency map for a text string.
 */
export function buildTermFrequencies(text) {
  const tf = new Map();
  for (const term of tokenize(text)) {
    tf.set(term, (tf.get(term) || 0) + 1);
  }
  return tf;
}

/**
 * Build IDF values for a corpus of term-frequency maps.
 * Returns Map<term, idf_value>.
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
    // Robertson-Sparck Jones IDF variant
    idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
  }
  return idf;
}

/**
 * Rank a list of documents by BM25 score against a query.
 * Each document must have a `text` field (or `body`/`summary`/`content` as fallback).
 * Returns documents sorted by score descending, with a `.score` property added.
 */
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

export function scoreEmbeddedDocuments(documents = [], query, { limit = 10 } = {}) {
  const queryEmbedding = embedText(query);
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
