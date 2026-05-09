/**
 * lib/storage/embeddings-legacy.mjs — Hashing-bow-v1 adapter for the embedding engine.
 *
 * Self-contained implementation of a deterministic, dependency-free embedding via
 * SHA256-bucketed bag-of-words. Used only when CONSTRUCT_EMBEDDING_MODEL=hashing.
 * Lower quality than the local ONNX adapter; kept as a fallback for tests and
 * for environments where the ONNX runtime is unavailable.
 *
 * The hashing implementation lives here so that lib/storage/embeddings.mjs
 * can hold only the pure BM25/cosine/tokenize utilities. Embedding adapters
 * live alongside the engine; utilities live in embeddings.mjs.
 */

import crypto from 'node:crypto';
import { tokenize } from './embeddings.mjs';

export const MODEL_ID = 'hashing-bow-v1';
export const DIMENSIONS = 256;

function bucketForToken(token, dimensions) {
  const hash = crypto.createHash('sha256').update(token).digest();
  return hash.readUInt32BE(0) % dimensions;
}

function signForToken(token) {
  const hash = crypto.createHash('sha256').update(token).digest();
  return (hash[4] & 1) === 0 ? 1 : -1;
}

function hashEmbedding(text, dimensions = DIMENSIONS) {
  const vector = new Array(dimensions).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) return new Float32Array(vector);

  for (const token of tokens) {
    vector[bucketForToken(token, dimensions)] += signForToken(token);
  }

  let normSq = 0;
  for (const v of vector) normSq += v * v;
  const norm = Math.sqrt(normSq);
  if (norm === 0) return new Float32Array(vector);

  const out = new Float32Array(dimensions);
  for (let i = 0; i < dimensions; i++) out[i] = Number((vector[i] / norm).toFixed(8));
  return out;
}

/**
 * Synchronous embed helper for legacy callers (observation/entity/session
 * stores, trends, RAG corpus builders) that haven't yet migrated to the
 * async engine. Returns a plain Array of length `DIMENSIONS` so existing
 * callers using `cosineSimilarity(...)` continue to work without changes.
 *
 * New code MUST use `embedText` from `embeddings-engine.mjs` instead — the
 * sync helper here exists only to ease migration of legacy callers.
 */
export function embedSync(text) {
  return Array.from(hashEmbedding(String(text || '')));
}

export async function embed(text /* , { env = process.env } = {} */) {
  return {
    embedding: hashEmbedding(String(text || '')),
    model: MODEL_ID,
    dimensions: DIMENSIONS,
  };
}

export async function embedBatch(texts /* , { env = process.env } = {} */) {
  return texts.map((t) => ({
    embedding: hashEmbedding(String(t || '')),
    model: MODEL_ID,
    dimensions: DIMENSIONS,
  }));
}

export function getModelInfo(/* { env = process.env } = {} */) {
  return {
    id: 'hashing',
    model: MODEL_ID,
    provider: 'local',
    dimensions: DIMENSIONS,
  };
}
