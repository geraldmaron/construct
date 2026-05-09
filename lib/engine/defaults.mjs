/**
 * lib/engine/defaults.mjs — Built-in default plugin implementations.
 *
 * Each export is a factory that returns a contract-satisfying plugin instance.
 * Defaults are deliberately the minimum needed to keep the contract live; the
 * stronger implementations live in their own modules and are wired in below.
 *
 * Embedder default is `local-onnx` (Xenova/all-MiniLM-L6-v2, 384d). Existing
 * `lib/storage/embeddings-engine.mjs` is the adapter; this default just wraps
 * it under the Embedder contract so callers go through `engine.layers.embedder`
 * exclusively.
 */

// The Embedder default routes through the model-agnostic engine so the
// configured model (local | openai | ollama | hashing) drives dimensionality
// and behavior end-to-end through one call site.

import {
  embedText as embedTextEngine,
  embedBatch as embedBatchEngine,
  getEmbeddingModelInfo,
} from '../storage/embeddings-engine.mjs';

// ── Embedder default ──────────────────────────────────────────────────────

export function createDefaultEmbedder() {
  return {
    meta: {
      id: 'construct-default-embedder',
      modelId: 'pending-init',
      dimensions: 1,
    },
    async init() {
      const info = await getEmbeddingModelInfo();
      this.meta.modelId = info.model;
      this.meta.dimensions = info.dimensions;
      return this;
    },
    async embed(text) {
      const r = await embedTextEngine(text);
      return r.embedding;
    },
    async embedBatch(texts) {
      const results = await embedBatchEngine(texts);
      return results.map((r) => r.embedding);
    },
  };
}

// ── Chunker default ───────────────────────────────────────────────────────

// Heading-prefix chunker: splits markdown at heading boundaries and
// prepends each chunk with its heading chain so retrieved chunks carry
// doc-relative context. Operators that want LM-generated per-chunk context
// (the strongest known retrieval technique) plug it in via the Chunker slot.

import { create as createHeadingsChunker } from './chunker-headings.mjs';

export function createDefaultChunker() {
  return createHeadingsChunker();
}

// ── Indexer default ───────────────────────────────────────────────────────

// Storage is delegated to `lib/storage/vector-client.mjs` and
// `lib/storage/sync.mjs`. The default indexer here is a thin contract
// surface; richer indexer plugins (e.g. external vector DBs) can replace it.

export function createDefaultIndexer() {
  return {
    meta: { id: 'construct-default-indexer', mode: 'pgvector-or-file' },
    async store(/* chunks, embeddings */) {
      return { stored: 0, mode: 'deferred', note: 'store delegated to lib/storage/sync.mjs' };
    },
    async query(/* queryEmbedding, opts */) {
      return [];
    },
    async health() {
      return { ok: true, mode: 'delegated', note: 'health checks live in lib/storage/vector-client.mjs' };
    },
  };
}

// ── Fuser default ─────────────────────────────────────────────────────────

// Reciprocal Rank Fusion (RRF) — corpus-agnostic, parameter-light, removes
// the BM25/cosine top-K asymmetry that the previous weighted-sum had.

import { create as createRrfFuser } from './fuser-rrf.mjs';
import { create as createMmrReranker } from './reranker-mmr.mjs';

export function createDefaultFuser() {
  return createRrfFuser();
}

// ── Reranker default ──────────────────────────────────────────────────────

// Maximal Marginal Relevance (MMR) — balances relevance against diversity to
// drop near-duplicates without a hard threshold. λ=0.7 favors relevance.

export function createDefaultReranker() {
  return createMmrReranker();
}

// ── Compressor default ────────────────────────────────────────────────────

// TF-IDF sentence-selector compressor — zero deps, modest compression that
// runs on every machine. Operators that want learned compression
// (LLMLingua-style) plug it in via the Compressor slot.

import { create as createHeuristicCompressor } from './compressor-heuristic.mjs';

export function createDefaultCompressor() {
  return createHeuristicCompressor();
}

// ── Aggregate loader ──────────────────────────────────────────────────────

export async function loadDefaults() {
  const embedder = createDefaultEmbedder();
  if (typeof embedder.init === 'function') await embedder.init();
  return {
    embedder,
    chunker: createDefaultChunker(),
    indexer: createDefaultIndexer(),
    fuser: createDefaultFuser(),
    reranker: createDefaultReranker(),
    compressor: createDefaultCompressor(),
  };
}
