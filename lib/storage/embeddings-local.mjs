/**
 * lib/storage/embeddings-local.mjs — Local ONNX embedding via @huggingface/transformers.
 *
 * Lazy-loads the model, caches to disk, uses a single-worker queue to avoid
 * parallel inference contention. Falls back to hashing-bow-v1 if the model
 * fails to load.
 *
 * Model: Xenova/all-MiniLM-L6-v2 (384 dimensions, quantized)
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';

let modelPromise = null;
let extractor = null;

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DIMENSIONS = 384;

async function getExtractor(cacheDir) {
  if (extractor) return extractor;
  if (modelPromise) return modelPromise;

  const cachePath = cacheDir || join(homedir(), '.construct', 'cache', 'embeddings');
  if (!existsSync(cachePath)) {
    mkdirSync(cachePath, { recursive: true });
  }

  modelPromise = (async () => {
    const { pipeline, env: hfEnv } = await import('@huggingface/transformers');
    hfEnv.allowLocalModels = true;
    hfEnv.useBrowserCache = false;
    try {
      const ex = await pipeline('feature-extraction', MODEL_ID, {
        cache_dir: cachePath,
        quantized: true,
      });
      extractor = ex;
      return ex;
    } catch (err) {
      modelPromise = null;
      throw new Error(`Local embedding model failed to load: ${err.message}. Falling back to hashing-bow-v1.`);
    }
  })();

  return modelPromise;
}

export async function embed(text, { env = process.env } = {}) {
  try {
    if (env.CONSTRUCT_EMBEDDING_DISABLE_LOCAL === '1') {
      throw new Error('local embeddings disabled by CONSTRUCT_EMBEDDING_DISABLE_LOCAL');
    }
    const ex = await getExtractor(env.CONSTRUCT_EMBEDDING_CACHE_DIR);
    const output = await ex(text, { pooling: 'mean', normalize: true });
    return {
      embedding: output.data,
      model: MODEL_ID,
      dimensions: DIMENSIONS,
    };
  } catch (err) {
    const { embed: hashEmbed } = await import('./embeddings-legacy.mjs');
    const fallback = await hashEmbed(text, { env });
    return {
      ...fallback,
      degraded: true,
      requestedModel: MODEL_ID,
      fallbackReason: err?.message || 'local embedding model unavailable',
    };
  }
}

export async function embedBatch(texts, { env = process.env } = {}) {
  try {
    if (env.CONSTRUCT_EMBEDDING_DISABLE_LOCAL === '1') {
      throw new Error('local embeddings disabled by CONSTRUCT_EMBEDDING_DISABLE_LOCAL');
    }
    const ex = await getExtractor(env.CONSTRUCT_EMBEDDING_CACHE_DIR);
    const results = [];
    for (const text of texts) {
      const output = await ex(text, { pooling: 'mean', normalize: true });
      results.push({
        embedding: output.data,
        model: MODEL_ID,
        dimensions: DIMENSIONS,
      });
    }
    return results;
  } catch (err) {
    const { embedBatch: hashBatch } = await import('./embeddings-legacy.mjs');
    const fallbacks = await hashBatch(texts, { env });
    return fallbacks.map((fallback) => ({
      ...fallback,
      degraded: true,
      requestedModel: MODEL_ID,
      fallbackReason: err?.message || 'local embedding model unavailable',
    }));
  }
}

export function getModelInfo({ env = process.env } = {}) {
  return {
    id: 'local',
    model: MODEL_ID,
    provider: 'onnx',
    dimensions: DIMENSIONS,
  };
}
