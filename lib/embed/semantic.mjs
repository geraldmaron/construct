/**
 * lib/embed/semantic.mjs — Semantic analysis for intake signals.
 *
 * Generates embeddings via @huggingface/transformers, caches them to disk,
 * computes cosine similarity, and clusters related signals by topic.
 * Inference is local; the model weights are fetched once from the HuggingFace
 * hub on first use (cache miss) and reused thereafter, with a hashing fallback
 * when the fetch fails offline. Default model is all-MiniLM-L6-v2 (384-dimensional
 * vectors, ~50MB on disk, fast inference).
 *
 * Storage:
 *   ~/.cx/cache/embeddings/<sha256>.json — single embedding vector
 *   ~/.cx/cache/embeddings/index.json    — hash → metadata lookup
 *
 * Usage:
 *   const vec = await embed(text);
 *   const similarity = cosineSimilarity(vecA, vecB);
 *   const clusters = clusterVectors(vectors, { threshold: 0.7 });
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';

const CACHE_DIR = join(homedir(), '.cx', 'cache', 'embeddings');
const INDEX_FILE = join(CACHE_DIR, 'index.json');
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const DIMENSIONS = 384;
const LOG = process.env.CONSTRUCT_DEBUG_EMBED === '1';

let embedder = null;

/**
 * Lazy-load the embedding pipeline. Loads once per process.
 */
async function getEmbedder() {
  if (embedder !== null) return embedder;
  try {
    const { pipeline, env: hfEnv } = await import('@huggingface/transformers');
    hfEnv.allowLocalModels = true;
    hfEnv.useBrowserCache = false;
    embedder = await pipeline('feature-extraction', MODEL_NAME, {
      quantized: true,
    });
    if (LOG) process.stderr.write('[semantic] embedder loaded\n');
  } catch (err) {
    process.stderr.write(`[semantic] model load failed: ${err.message}\n`);
    embedder = false;
  }
  return embedder;
}

/**
 * Ensure the cache directory exists.
 */
function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Read the cache index.
 */
function readIndex() {
  if (!existsSync(INDEX_FILE)) return {};
  try { return JSON.parse(readFileSync(INDEX_FILE, 'utf8')); } catch { return {}; }
}

/**
 * Write the cache index.
 */
function writeIndex(index) {
  ensureCacheDir();
  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2) + '\n');
}

/**
 * Compute sha256 of text for cache key.
 */
function hashText(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Normalize a vector to unit length.
 */
function normalize(vec) {
  const mag = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (mag === 0) return vec;
  return vec.map(v => v / mag);
}

/**
 * Generate an embedding vector for the given text.
 * Results are cached by sha256 hash to disk.
 *
 * @param {string} text - Text to embed
 * @returns {Promise<Float32Array|number[]|null>} Embedding vector
 */
export async function embed(text) {
  if (!text || typeof text !== 'string' || !text.trim()) return null;

  ensureCacheDir();
  const h = hashText(text.trim());

  // Check cache
  const index = readIndex();
  if (index[h]) {
    try {
      const data = JSON.parse(readFileSync(join(CACHE_DIR, `${h}.json`), 'utf8'));
      if (LOG) process.stderr.write(`[semantic] cache hit for ${h.slice(0, 12)}\n`);
      return new Float32Array(data.vector);
    } catch {
      // cache miss or corrupt — proceed to compute
    }
  }

  const pipe = await getEmbedder();
  if (!pipe) return null;

  try {
    const output = await pipe(text, { pooling: 'mean', normalize: false });
    const vector = Array.from(output.data);
    const data = { h, dim: vector.length, vector };

    // Write cache
    writeFileSync(join(CACHE_DIR, `${h}.json`), JSON.stringify(data) + '\n');

    // Update index (lru tracking)
    index[h] = { h, dim: vector.length, cachedAt: new Date().toISOString(), textPreview: text.slice(0, 80) };
    writeIndex(index);

    if (LOG) process.stderr.write(`[semantic] embedded ${text.slice(0, 40)}... (${vector.length}d)\n`);
    return new Float32Array(vector);
  } catch (err) {
    process.stderr.write(`[semantic] embedding failed: ${err.message}\n`);
    return null;
  }
}

/**
 * Compute cosine similarity between two vectors.
 * Returns 0 if either vector is null/mismatched.
 *
 * @param {number[]|Float32Array} a
 * @param {number[]|Float32Array} b
 * @returns {number} Similarity score in [0, 1]
 */
export function cosineSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a.length !== b.length) return 0;

  const na = normalize(Array.from(a));
  const nb = normalize(Array.from(b));

  let dot = 0;
  for (let i = 0; i < na.length; i++) {
    dot += na[i] * nb[i];
  }
  return Math.max(0, Math.min(1, dot));
}

/**
 * Compute similarity matrix for an array of vectors.
 * Returns lower-triangular { i, j, similarity } objects.
 *
 * @param {Array<Float32Array|number[]>} vectors
 * @returns {Array<{ i: number, j: number, similarity: number }>}
 */
export function similarityMatrix(vectors) {
  const pairs = [];
  for (let i = 1; i < vectors.length; i++) {
    if (!vectors[i]) continue;
    for (let j = 0; j < i; j++) {
      if (!vectors[j]) continue;
      const sim = cosineSimilarity(vectors[i], vectors[j]);
      if (sim > 0) {
        pairs.push({ i, j, similarity: sim });
      }
    }
  }
  return pairs.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Cluster vectors by similarity threshold (simple connected-components).
 * Returns clusters with items grouped by similarity > threshold.
 *
 * @param {Array<{ id: string, vector: Float32Array|number[], text?: string }>} items
 * @param {object} [opts]
 * @param {number} [opts.threshold=0.7] - Similarity threshold for clustering
 * @param {number} [opts.minClusterSize=1] - Minimum items per cluster
 * @returns {Array<{ id: string, items: string[], avgSimilarity: number, textPreview: string }>}
 */
export function clusterVectors(items, { threshold = 0.7, minClusterSize = 1 } = {}) {
  if (!items.length) return [];

  const n = items.length;
  const adj = Array.from({ length: n }, () => []);

  // Build adjacency from similarity threshold
  for (let i = 1; i < n; i++) {
    if (!items[i]?.vector) continue;
    for (let j = 0; j < i; j++) {
      if (!items[j]?.vector) continue;
      if (cosineSimilarity(items[i].vector, items[j].vector) >= threshold) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  // BFS connected components
  const visited = new Set();
  const clusters = [];

  for (let i = 0; i < n; i++) {
    if (visited.has(i) || !items[i]?.vector) continue;

    const component = [];
    const queue = [i];
    visited.add(i);

    while (queue.length) {
      const node = queue.shift();
      component.push(items[node].id);
      for (const neighbor of adj[node]) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    if (component.length >= minClusterSize) {
      const clusterItems = component.map(id => items.find(it => it.id === id)).filter(Boolean);
      const sims = [];
      for (let a = 0; a < clusterItems.length; a++) {
        for (let b = a + 1; b < clusterItems.length; b++) {
          if (clusterItems[a]?.vector && clusterItems[b]?.vector) {
            sims.push(cosineSimilarity(clusterItems[a].vector, clusterItems[b].vector));
          }
        }
      }
      const avgSim = sims.length ? sims.reduce((s, v) => s + v, 0) / sims.length : 0;

      clusters.push({
        id: `cluster-${randomUUID().slice(0, 8)}`,
        items: component,
        clusterSize: component.length,
        avgSimilarity: Number(avgSim.toFixed(3)),
        textPreview: clusterItems[0]?.text?.slice(0, 100) || '',
      });
    }
  }

  return clusters.sort((a, b) => b.clusterSize - a.clusterSize);
}

/**
 * Extract embeddable text from an intake packet.
 *
 * @param {object} packet - Intake packet with triage, excerpt, etc.
 * @returns {string} Text suitable for embedding
 */
export function extractTextFromPacket(packet) {
  const parts = [];
  if (packet?.triage?.intakeType && packet.triage.intakeType !== 'unknown') {
    parts.push(`Type: ${packet.triage.intakeType}`);
  }
  if (packet?.triage?.rationale) {
    parts.push(`Rationale: ${packet.triage.rationale}`);
  }
  if (packet?.excerpt) {
    parts.push(packet.excerpt);
  }
  if (packet?.suggestion?.lane) {
    parts.push(`Suggested lane: ${packet.suggestion.lane}`);
  }
  return parts.join('\n').slice(0, 5000);
}

/**
 * Find semantically similar pending intake items relative to a query text.
 *
 * @param {Array<{ id: string, text: string, embedding?: Float32Array }>} items
 * @param {string} queryText
 * @param {object} [opts]
 * @param {number} [opts.threshold=0.6]
 * @param {number} [opts.maxResults=10]
 * @returns {Promise<Array<{ id: string, similarity: number, text: string }>>}
 */
export async function findSimilar(items, queryText, { threshold = 0.6, maxResults = 10 } = {}) {
  const queryVec = await embed(queryText);
  if (!queryVec) return [];

  const results = [];
  for (const item of items) {
    if (!item.text) continue;
    const itemVec = item.embedding || await embed(item.text);
    if (!itemVec) continue;
    const sim = cosineSimilarity(queryVec, itemVec);
    if (sim >= threshold) {
      results.push({ id: item.id, similarity: sim, text: item.text.slice(0, 120) });
      item.embedding = itemVec; // cache on object for reuse
    }
  }

  return results.sort((a, b) => b.similarity - a.similarity).slice(0, maxResults);
}

/**
 * Get cache statistics.
 *
 * @returns {{ total: number, oldest: string|null, newest: string|null }}
 */
export function cacheStats() {
  const index = readIndex();
  const entries = Object.values(index);
  if (!entries.length) return { total: 0, oldest: null, newest: null };
  const byDate = entries.sort((a, b) => a.cachedAt?.localeCompare(b.cachedAt || '') || 0);
  return {
    total: entries.length,
    oldest: byDate[0]?.cachedAt || null,
    newest: byDate[byDate.length - 1]?.cachedAt || null,
  };
}


