#!/usr/bin/env node
/**
 * lib/storage/vector-store.mjs — derived semantic retrieval facade.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { EMBEDDING_MODEL, scoreEmbeddedDocuments, rankByBm25 } from './embeddings.mjs';

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
    return {
      version: 1,
      model: EMBEDDING_MODEL,
      updatedAt: null,
      records: [],
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(resolvedPath, 'utf8'));
    return {
      version: parsed.version ?? 1,
      model: parsed.model || EMBEDDING_MODEL,
      updatedAt: parsed.updatedAt || null,
      records: Array.isArray(parsed.records) ? parsed.records : [],
    };
  } catch {
    return {
      version: 1,
      model: EMBEDDING_MODEL,
      updatedAt: null,
      records: [],
    };
  }
}

export function writeLocalVectorIndex(indexPath, records = [], { model = EMBEDDING_MODEL } = {}) {
  const resolvedPath = resolve(String(indexPath || ''));
  if (!resolvedPath) throw new Error('Missing local vector index path');
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

export function searchLocalVectorIndex(indexPath, query = '', { limit = 10 } = {}) {
  const index = readLocalVectorIndex(indexPath);
  return scoreEmbeddedDocuments(index.records, query, { limit });
}

export function vectorSearchLocal(records = [], query = '', { limit = 10 } = {}) {
  // Use BM25 ranking instead of naive term-count for better keyword recall.
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
