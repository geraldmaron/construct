#!/usr/bin/env node
/**
 * lib/storage/vector-store.mjs — Local JSON vector index facade.
 *
 * Stores vector records on disk for fallback retrieval when no SQL backend is
 * available. The model field is metadata supplied by the caller — this module
 * does not embed; it only persists what the engine produces.
 *
 * Search APIs accept a pre-computed query embedding so the embedding model is
 * the caller's choice and there is no implicit dependency on a specific model
 * inside this module.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { scoreByEmbedding, rankByBm25 } from './embeddings.mjs';
import { embedSync } from './embeddings-legacy.mjs';

export function vectorStoreMode(env = process.env) {
  if (env.CONSTRUCT_VECTOR_URL) return 'remote';
  if (env.CONSTRUCT_VECTOR_INDEX_PATH) return 'local';
  return 'file';
}

export function describeVectorStore(env = process.env) {
  const mode = vectorStoreMode(env);
  return {
    mode,
    configured: mode !== 'file',
    sharedReady: mode === 'remote',
    fallbackAvailable: true,
    endpoint: env.CONSTRUCT_VECTOR_URL || null,
    indexPath: env.CONSTRUCT_VECTOR_INDEX_PATH || null,
    model: env.CONSTRUCT_VECTOR_MODEL || null,
  };
}

export function readLocalVectorIndex(indexPath) {
  const resolvedPath = resolve(String(indexPath || ''));
  if (!resolvedPath || !existsSync(resolvedPath)) {
    return { version: 1, model: null, updatedAt: null, records: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(resolvedPath, 'utf8'));
    return {
      version: parsed.version ?? 1,
      model: parsed.model || null,
      updatedAt: parsed.updatedAt || null,
      records: Array.isArray(parsed.records) ? parsed.records : [],
    };
  } catch {
    return { version: 1, model: null, updatedAt: null, records: [] };
  }
}

export function writeLocalVectorIndex(indexPath, records = [], { model } = {}) {
  const resolvedPath = resolve(String(indexPath || ''));
  if (!resolvedPath) throw new Error('Missing local vector index path');
  if (!model) throw new Error('writeLocalVectorIndex requires an explicit model id (caller must supply)');
  mkdirSync(dirname(resolvedPath), { recursive: true });
  const payload = {
    version: 1,
    model,
    updatedAt: new Date().toISOString(),
    records,
  };
  writeFileSync(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

/**
 * Search the local vector index. Accepts either a query string (which is
 * embedded via the legacy hashing adapter inline — fast, deterministic, no
 * engine init) or a pre-computed query embedding for engine-aligned callers.
 *
 * The hashing path matches what `addObservation` and `syncFileStateToSql`
 * write to disk when no SQL backend is configured, so dimensions agree.
 * Callers that store engine-dim vectors should pass an explicit Float32Array.
 */
export function searchLocalVectorIndex(indexPath, query, { limit = 10 } = {}) {
  const index = readLocalVectorIndex(indexPath);
  const queryEmbedding = typeof query === 'string'
    ? embedSync(query)
    : (query instanceof Float32Array ? Array.from(query) : (query || []));
  return scoreByEmbedding(index.records, queryEmbedding, { limit });
}

export function vectorSearchLocal(records = [], query = '', { limit = 10 } = {}) {
  const bm25Docs = records.map((record) => ({
    ...record,
    text: [
      record.title,
      record.summary,
      record.body,
      record.text,
      Array.isArray(record.tags) ? record.tags.join(' ') : '',
    ].filter(Boolean).join('\n'),
  }));
  return rankByBm25(bm25Docs, query, { limit });
}
