/**
 * lib/engine/knowledge-store-contract.mjs — KnowledgeStore provider contract.
 *
 * Names four deployment modes and six capability axes so callers (rag.mjs,
 * hybrid-query.mjs, MCP tools) resolve provider health and selection through
 * one surface instead of probing LanceDB, Postgres, and embeddings independently.
 * Hand-rolled validation only; no Ajv/zod.
 */

import { getDeploymentMode } from '../deployment-mode.mjs';
import { createRetrievalAdapter, resolveAdapterMode } from '../storage/retrieval-adapter.mjs';

export const KNOWLEDGE_STORE_MODES = Object.freeze([
  'minimal-local',
  'capable-local-semantic',
  'team',
  'remote-where-justified',
]);

export const KNOWLEDGE_STORE_AXES = Object.freeze([
  'metadata',
  'keyword',
  'vector',
  'embedding',
  'reranking',
  'storage',
]);

function resolveEmbeddingBackend(env = process.env) {
  return String(env.CONSTRUCT_EMBEDDING_MODEL || 'local').toLowerCase().trim();
}

function postgresConfigured(env = process.env) {
  return Boolean(
    env.CONSTRUCT_DATABASE_URL
    || env.DATABASE_URL
    || env.CONSTRUCT_POSTGRES_URL,
  );
}

function axisAvailability(mode, adapterMode, adapterHealthy) {
  const keyword = true;
  const vector = adapterMode === 'lancedb' && adapterHealthy;
  const embedding = mode !== 'minimal-local' || resolveEmbeddingBackend() !== 'hashing';
  const metadata = true;
  const reranking = vector;
  const storage = mode === 'team' ? 'postgres' : 'local';
  return Object.freeze({
    metadata,
    keyword,
    vector,
    embedding,
    reranking,
    storage,
  });
}

/**
 * Resolve the active KnowledgeStore deployment mode and provider selection.
 *
 * @param {{ env?: object, rootDir?: string }} [opts]
 * @returns {Promise<{
 *   mode: string,
 *   adapterMode: string,
 *   adapterHealthy: boolean,
 *   embeddingBackend: string,
 *   retrievalAdapterEnv: string,
 *   axes: Record<string, boolean|string>,
 * }>}
 */
export async function resolveKnowledgeStoreSelection({
  env = process.env,
  rootDir = process.cwd(),
} = {}) {
  const retrievalAdapterEnv = resolveAdapterMode(env);
  const deploymentMode = getDeploymentMode(env, { cwd: rootDir });
  const embeddingBackend = resolveEmbeddingBackend(env);

  let adapter;
  let adapterHealthy = false;
  let adapterMode = 'keyword';

  try {
    adapter = await createRetrievalAdapter({ env, rootDir });
    adapterMode = adapter.mode;
    adapterHealthy = await adapter.isHealthy().catch(() => false);
    if (typeof adapter.close === 'function') {
      await adapter.close().catch(() => {});
    }
  } catch {
    adapterMode = retrievalAdapterEnv === 'lancedb' ? 'lancedb' : 'keyword';
    adapterHealthy = false;
  }

  let mode = 'minimal-local';
  if (adapterMode === 'lancedb' && adapterHealthy) {
    mode = 'capable-local-semantic';
  }
  if ((deploymentMode === 'team' || deploymentMode === 'enterprise') && postgresConfigured(env)) {
    mode = 'team';
  }

  return Object.freeze({
    mode,
    adapterMode,
    adapterHealthy,
    embeddingBackend,
    retrievalAdapterEnv,
    axes: axisAvailability(mode, adapterMode, adapterHealthy),
  });
}

/**
 * Assert a named axis is available for the resolved selection.
 *
 * @param {object} selection — output of resolveKnowledgeStoreSelection
 * @param {string} axis — one of KNOWLEDGE_STORE_AXES
 */
export function assertKnowledgeStoreCapability(selection, axis) {
  if (!KNOWLEDGE_STORE_AXES.includes(axis)) {
    throw new Error(`Unknown KnowledgeStore axis: ${axis}`);
  }
  const value = selection?.axes?.[axis];
  if (!value) {
    throw new Error(
      `KnowledgeStore axis '${axis}' unavailable in mode '${selection?.mode ?? 'unknown'}'`,
    );
  }
}

/**
 * @param {object} selection
 * @param {string} axis
 * @returns {boolean}
 */
export function checkKnowledgeStoreCapability(selection, axis) {
  try {
    assertKnowledgeStoreCapability(selection, axis);
    return true;
  } catch {
    return false;
  }
}
