/**
 * lib/engine/index.mjs — Public entry point for the Construct retrieval engine.
 *
 * Single import surface for callers that need plugin-resolved layers
 * (Embedder, Chunker, Indexer, Fuser, Reranker, Compressor). Resolution is
 * cached per (rootDir) — engines are reusable across calls in the same process,
 * so we avoid re-loading ONNX models or re-reading plugins.json on every query.
 *
 * Use `getEngine({ rootDir })` to fetch the cached engine. `resetEngine()`
 * forces a re-resolution (useful for tests and `construct doctor` after a
 * plugin config change).
 */

import { resolveEngine, describeEngine } from './registry.mjs';
import { LAYERS, assertContract, checkContract } from './contracts.mjs';

const CACHE = new Map();

/**
 * Return the resolved engine for a project root. Cached per rootDir.
 *
 * @param {object} [opts]
 * @param {string} [opts.rootDir]
 * @returns {Promise<{ layers, sources, errors }>}
 */
export async function getEngine({ rootDir = process.cwd() } = {}) {
  if (!CACHE.has(rootDir)) {
    CACHE.set(rootDir, resolveEngine({ rootDir }));
  }
  return CACHE.get(rootDir);
}

export function resetEngine() {
  CACHE.clear();
}

export { describeEngine, LAYERS, assertContract, checkContract };
