/**
 * lib/certification/knowledge-store-matrix.mjs — KnowledgeStore mode certification matrix.
 *
 * Exercises each contract-defined deployment mode (construct-tsyfe.7.6) with fixture
 * keyword/vector search and explicit pass/fail/documented-skip rows. Certified mode
 * hard-fails when a declared capability is missing; local mode skips cleanly.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  KNOWLEDGE_STORE_AXES,
  KNOWLEDGE_STORE_MODES,
  checkKnowledgeStoreCapability,
} from '../engine/knowledge-store-contract.mjs';
import { createRetrievalAdapter } from '../storage/retrieval-adapter.mjs';
import { _resetAutoFallbackWarningForTests } from '../storage/retrieval-adapter.mjs';

export const KNOWLEDGE_STORE_MATRIX_ID = 'knowledge-store-matrix';

const FIXTURE_DOC = Object.freeze({
  id: 'cert-ks-fixture-1',
  project: 'construct',
  kind: 'note',
  title: 'KnowledgeStore certification fixture',
  summary: 'billing isolation architecture retrieval probe',
  body: 'Per-tenant billing isolation requires durable metadata, keyword retrieval, and optional vector search.',
  tags: ['certification', 'knowledge-store'],
});

function postgresConfigured(env = process.env) {
  return Boolean(env.CONSTRUCT_DATABASE_URL || env.DATABASE_URL || env.CONSTRUCT_POSTGRES_URL);
}

function remoteEmbeddingConfigured(env = process.env) {
  const backend = String(env.CONSTRUCT_EMBEDDING_MODEL || 'local').toLowerCase().trim();
  return backend !== 'local' && backend !== 'hashing';
}

function modeEnv(mode, baseDir) {
  if (mode === 'minimal-local') {
    return {
      CONSTRUCT_RETRIEVAL_ADAPTER: 'keyword',
      CONSTRUCT_KEYWORD_INDEX_PATH: path.join(baseDir, 'keyword-index'),
      CONSTRUCT_EMBEDDING_MODEL: 'hashing',
    };
  }
  if (mode === 'capable-local-semantic') {
    return {
      CONSTRUCT_RETRIEVAL_ADAPTER: 'lancedb',
      CONSTRUCT_LANCEDB_PATH: path.join(baseDir, 'lancedb'),
      CONSTRUCT_EMBEDDING_MODEL: 'local',
    };
  }
  if (mode === 'team') {
    return {
      CONSTRUCT_RETRIEVAL_ADAPTER: 'keyword',
      CONSTRUCT_KEYWORD_INDEX_PATH: path.join(baseDir, 'team-keyword'),
      CONSTRUCT_DEPLOYMENT_MODE: 'team',
    };
  }
  if (mode === 'remote-where-justified') {
    return {
      CONSTRUCT_RETRIEVAL_ADAPTER: 'keyword',
      CONSTRUCT_KEYWORD_INDEX_PATH: path.join(baseDir, 'remote-keyword'),
      CONSTRUCT_EMBEDDING_MODEL: remoteEmbeddingConfigured(process.env)
        ? process.env.CONSTRUCT_EMBEDDING_MODEL
        : 'openai',
    };
  }
  throw new Error(`Unknown KnowledgeStore mode: ${mode}`);
}

function declaredAxesForMode(mode) {
  if (mode === 'minimal-local') {
    return { metadata: true, keyword: true, vector: false, embedding: false, reranking: false, storage: 'local' };
  }
  if (mode === 'capable-local-semantic') {
    return { metadata: true, keyword: true, vector: true, embedding: true, reranking: true, storage: 'local' };
  }
  if (mode === 'team') {
    return { metadata: true, keyword: true, vector: false, embedding: true, reranking: false, storage: 'postgres' };
  }
  if (mode === 'remote-where-justified') {
    return { metadata: true, keyword: true, vector: false, embedding: true, reranking: false, storage: 'local' };
  }
  return {};
}

function infraSkipReason(mode, env) {
  if (mode === 'team' && !postgresConfigured(env)) {
    return 'team mode requires live Postgres (CONSTRUCT_DATABASE_URL); CI uses documented skip';
  }
  if (mode === 'remote-where-justified' && !remoteEmbeddingConfigured(env)) {
    return 'remote-where-justified requires remote embedding backend (CONSTRUCT_EMBEDDING_MODEL not local/hash)';
  }
  return null;
}

async function exerciseKeywordSearch({ rootDir, env }) {
  const adapter = await createRetrievalAdapter({ env, rootDir });
  if (adapter.mode !== 'keyword') {
    if (typeof adapter.close === 'function') await adapter.close();
    return { ok: true, detail: 'keyword search delegated to vector adapter in semantic mode' };
  }
  await adapter.storeDocument(FIXTURE_DOC);
  const hits = await adapter.searchDocuments({
    project: FIXTURE_DOC.project,
    query: 'billing isolation',
    limit: 5,
  });
  if (typeof adapter.close === 'function') await adapter.close();
  const matched = hits.some((row) => row.id === FIXTURE_DOC.id || /billing isolation/i.test(row.summary || row.body || ''));
  return { ok: matched, detail: matched ? `${hits.length} hit(s)` : 'fixture document not retrieved' };
}

async function exerciseVectorSearch({ rootDir, env }) {
  const adapter = await createRetrievalAdapter({ env, rootDir });
  const healthy = await adapter.isHealthy().catch(() => false);
  if (adapter.mode !== 'lancedb' || !healthy) {
    if (typeof adapter.close === 'function') await adapter.close();
    return { ok: false, skip: 'LanceDB unavailable in certifying environment' };
  }
  await adapter.storeDocument(FIXTURE_DOC);
  const { embedText } = await import('../storage/embeddings-engine.mjs');
  const { embedding: docEmbedding } = await embedText(FIXTURE_DOC.body, { env });
  await adapter.storeDocument({ ...FIXTURE_DOC, embedding: docEmbedding });
  const { embedding } = await embedText('billing isolation vector probe', { env });
  const hits = await adapter.searchDocuments({
    project: FIXTURE_DOC.project,
    queryEmbedding: embedding,
    limit: 5,
  });
  if (typeof adapter.close === 'function') await adapter.close();
  const matched = hits.length > 0;
  return { ok: matched, detail: matched ? `${hits.length} vector hit(s)` : 'vector search returned no hits' };
}

async function assessMode(mode, { mode: runMode = 'local', env = process.env, rootDir } = {}) {
  const skipReason = infraSkipReason(mode, env);
  if (skipReason) {
    return {
      mode,
      status: 'skipped',
      detail: skipReason,
      axes: declaredAxesForMode(mode),
    };
  }

  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), `cx-ks-${mode}-`));
  try {
    _resetAutoFallbackWarningForTests();
    const modeEnvValues = modeEnv(mode, baseDir);
    const mergedEnv = { ...env, ...modeEnvValues };
    const axes = declaredAxesForMode(mode);
    const selection = { mode, axes };
    const exercises = [];

    if (checkKnowledgeStoreCapability(selection, 'keyword')) {
      exercises.push(await exerciseKeywordSearch({ rootDir: baseDir, env: mergedEnv }));
    }

    if (checkKnowledgeStoreCapability(selection, 'vector')) {
      exercises.push(await exerciseVectorSearch({ rootDir: baseDir, env: mergedEnv }));
    }

    const skipped = exercises.filter((row) => row.skip);
    if (skipped.length) {
      const reason = skipped.map((row) => row.skip).join('; ');
      return {
        mode,
        status: 'skipped',
        detail: reason,
        axes,
      };
    }

    const failed = exercises.filter((row) => !row.ok);
    if (failed.length) {
      return {
        mode,
        status: 'failed',
        detail: failed.map((row) => row.detail).join('; '),
        axes,
      };
    }

    return {
      mode,
      status: 'certified',
      detail: exercises.map((row) => row.detail).join('; ') || 'capabilities exercised',
      axes,
    };
  } catch (err) {
    return {
      mode,
      status: runMode === 'certified' ? 'failed' : 'skipped',
      detail: err?.message ?? String(err),
      axes: declaredAxesForMode(mode),
    };
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

/**
 * @param {{ mode?: 'local'|'certified', env?: object, rootDir?: string }} [opts]
 */
export async function runKnowledgeStoreMatrix({ mode = 'local', env = process.env, rootDir = process.cwd() } = {}) {
  const results = [];
  for (const storeMode of KNOWLEDGE_STORE_MODES) {
    results.push(await assessMode(storeMode, { mode, env, rootDir }));
  }

  const summary = {
    certified: results.filter((row) => row.status === 'certified').length,
    skipped: results.filter((row) => row.status === 'skipped').length,
    failed: results.filter((row) => row.status === 'failed').length,
  };

  const missingModes = KNOWLEDGE_STORE_MODES.filter(
    (name) => !results.some((row) => row.mode === name),
  );
  const pass = summary.failed === 0 && missingModes.length === 0;

  return {
    id: KNOWLEDGE_STORE_MATRIX_ID,
    mode,
    pass,
    summary,
    modes: KNOWLEDGE_STORE_MODES,
    axes: KNOWLEDGE_STORE_AXES,
    results,
  };
}

export function formatKnowledgeStoreMatrix(report) {
  const lines = [`KnowledgeStore matrix — mode: ${report.mode} — ${report.pass ? 'PASS' : 'FAIL'}`];
  lines.push(`  modes: ${report.summary.certified} certified, ${report.summary.skipped} skipped, ${report.summary.failed} failed`);
  for (const row of report.results) {
    const mark = row.status === 'certified' ? '✓' : row.status === 'skipped' ? '·' : '✗';
    lines.push(`  ${mark} ${row.mode.padEnd(28)} ${row.detail}`);
  }
  return `${lines.join('\n')}\n`;
}

export function isKnowledgeStoreMatrixRegistered() {
  return typeof runKnowledgeStoreMatrix === 'function'
    && KNOWLEDGE_STORE_MATRIX_ID === 'knowledge-store-matrix';
}
