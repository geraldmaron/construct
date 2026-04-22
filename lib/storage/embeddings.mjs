#!/usr/bin/env node
/**
 * lib/storage/embeddings.mjs — deterministic local embeddings for hybrid retrieval.
 */
import crypto from 'node:crypto';

export const EMBEDDING_MODEL = 'hashing-bow-v1';
export const EMBEDDING_DIMENSIONS = 256;

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3);
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
