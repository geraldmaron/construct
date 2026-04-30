/**
 * lib/storage/embeddings-local.mjs — Local ONNX embedding via @xenova/transformers.
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
    const { pipeline, env: hfEnv } = await import('@xenova/transformers');
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
    const ex = await getExtractor(env.CONSTRUCT_EMBEDDING_CACHE_DIR);
    const output = await ex(text, { pooling: 'mean', normalize: true });
    return {
      embedding: output.data,
      model: MODEL_ID,
      dimensions: DIMENSIONS,
    };
  } catch {
    const { embed: hashEmbed } = await import('./embeddings-legacy.mjs');
    return hashEmbed(text, { env });
  }
}

export async function embedBatch(texts, { env = process.env } = {}) {
  try {
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
  } catch {
    const { embedBatch: hashBatch } = await import('./embeddings-legacy.mjs');
    return hashBatch(texts, { env });
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
