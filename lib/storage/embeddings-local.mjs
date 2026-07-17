/**
 * lib/storage/embeddings-local.mjs — Local ONNX embedding via @huggingface/transformers.
 *
 * Lazy-loads the model from local cache only and runs inference offline. Falls
 * back to hashing-bow-v1 when the model is absent or fails to load. Remote model
 * fetching is disabled (allowRemoteModels=false): the runtime path never reaches
 * the network, so a first run with no cached weights degrades to the hashing
 * backend rather than downloading from the HuggingFace hub.
 *
 * Model: Xenova/all-MiniLM-L6-v2 (384 dimensions, quantized)
 */
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

import { cacheDir as xdgCacheDir } from '../config/xdg.mjs';

let modelPromise = null;
let extractor = null;

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DIMENSIONS = 384;

async function getExtractor(cacheDir) {
  if (extractor) return extractor;
  if (modelPromise) return modelPromise;

  const cachePath = cacheDir || join(xdgCacheDir(), 'embeddings');
  if (!existsSync(cachePath)) {
    mkdirSync(cachePath, { recursive: true });
  }

  modelPromise = (async () => {
    const { pipeline, env: hfEnv } = await import('@huggingface/transformers');
    hfEnv.allowLocalModels = true;
    hfEnv.allowRemoteModels = false;
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
    const { embed: hashEmbed } = await import('./embeddings-hashing.mjs');
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
    const { embedBatch: hashBatch } = await import('./embeddings-hashing.mjs');
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
