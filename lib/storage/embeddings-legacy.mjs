/**
 * lib/storage/embeddings-legacy.mjs — Backward-compatible wrapper for hashing-bow-v1.
 *
 * Adapts the legacy embedText() (which returns a plain array) to the new engine interface
 * (which expects { embedding: Float32Array, model: string, dimensions: number }).
 *
 * This is the fallback when no neural model is available.
 */
import { embedText as hashEmbed, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from './embeddings.mjs';

export { hashEmbed as _rawEmbed, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS };

/**
 * Embed a single text string using hashing-bow-v1.
 * @param {string} text
 * @param {{ env?: object }} opts
 * @returns {Promise<{ embedding: Float32Array, model: string, dimensions: number }>}
 */
export async function embed(text, { env = process.env } = {}) {
  const raw = hashEmbed(text);
  return {
    embedding: new Float32Array(raw),
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
  };
}

/**
 * Embed a batch of texts. Hashing-bow-v1 doesn't support native batching,
 * so we process in parallel.
 * @param {string[]} texts
 * @param {{ env?: object }} opts
 * @returns {Promise<{ embedding: Float32Array, model: string, dimensions: number }[]>}
 */
export async function embedBatch(texts, { env = process.env } = {}) {
  return Promise.all(texts.map((t) => embed(t, { env })));
}

/**
 * Return metadata about this embedding model.
 * @param {{ env?: object }} opts
 * @returns {{ id: string, model: string, provider: string, dimensions: number }}
 */
export function getModelInfo({ env = process.env } = {}) {
  return {
    id: 'hashing',
    model: EMBEDDING_MODEL,
    provider: 'local',
    dimensions: EMBEDDING_DIMENSIONS,
  };
}
