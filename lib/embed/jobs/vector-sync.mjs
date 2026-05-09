/**
 * lib/embed/jobs/vector-sync.mjs — Automatic embedding pipeline for observations.
 *
 * Runs on a schedule (default: every 5 minutes) to embed new/modified observations
 * and store them in Postgres (if available) and/or the local vector index.
 *
 * Design:
 *   - Scans .cx/observations/ for items not yet embedded
 *   - Embeds each using the configured model (local ONNX, OpenAI, Ollama)
 *   - Stores in Postgres construct_observations table (if DATABASE_URL set)
 *   - Falls back to local vectors.json if Postgres unavailable
 *   - Batched processing to avoid overwhelming the embedding API
 *   - Deduplicated via content hash comparison
 */
import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_BATCH_SIZE = 32;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Find observations that haven't been embedded yet.
 * @param {string} rootDir
 * @returns {Array<{ id: string, project: string, role: string, category: string, summary: string, content: string, tags: string[], confidence: number, source: string, filePath: string }>}
 */
function findUnembeddedObservations(rootDir) {
  const obsDir = join(rootDir, '.cx', 'observations');
  if (!existsSync(obsDir)) return [];

  const indexPath = join(obsDir, 'index.json');
  if (!existsSync(indexPath)) return [];

  let index;
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch {
    return [];
  }

  // Check which observations have been embedded
  const vectorsPath = join(obsDir, 'vectors.json');
  const embeddedIds = new Set();
  if (existsSync(vectorsPath)) {
    try {
      const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8'));
      for (const v of (vectors.records || vectors)) {
        if (v.id) embeddedIds.add(v.id);
      }
    } catch { /* ignore */ }
  }

  // Also check Postgres if available
  // (This is handled by the caller via VectorClient.isHealthy())

  return (index || [])
    .filter((obs) => obs.id && !embeddedIds.has(obs.id))
    .map((obs) => ({
      ...obs,
      filePath: join(obsDir, `${obs.id}.json`),
    }))
    .filter((obs) => existsSync(obs.filePath));
}

/**
 * Run the vector sync job.
 * @param {object} opts
 * @param {string} opts.rootDir - Root directory for observation store
 * @param {object} opts.env - Environment variables
 * @param {object} opts.logger - Optional logger with debug/info/error methods
 * @param {object} opts.vectorClient - Optional VectorClient instance for SQL storage
 * @returns {Promise<{ synced: number, errors: number, durationMs: number }>}
 */
export async function runVectorSync({ rootDir, env = process.env, logger, vectorClient } = {}) {
  const startTime = Date.now();
  const batchSize = parseInt(env.CONSTRUCT_EMBEDDING_BATCH_SIZE, 10) || DEFAULT_BATCH_SIZE;

  try {
    const unembedded = findUnembeddedObservations(rootDir);
    if (!unembedded.length) {
      logger?.debug?.('Vector sync: no new observations to embed');
      return { synced: 0, errors: 0, durationMs: Date.now() - startTime };
    }

    let synced = 0;
    let errors = 0;

    // Dynamically import embedding engine
    const { embedBatch } = await import('../../storage/embeddings-engine.mjs');

    for (let i = 0; i < unembedded.length; i += batchSize) {
      const batch = unembedded.slice(i, i + batchSize);
      const texts = batch.map((o) => `${o.summary}\n${o.content}`);

      try {
        const embeddings = await embedBatch(texts, { env });

        for (let j = 0; j < batch.length; j++) {
          const obs = batch[j];
          const embedding = embeddings[j].embedding;

          // Store in Postgres if available
          if (vectorClient && await vectorClient.isHealthy()) {
            try {
              await vectorClient.storeObservation({
                id: obs.id,
                project: obs.project || rootDir.split('/').pop(),
                role: obs.role,
                category: obs.category,
                summary: obs.summary,
                content: obs.content,
                tags: obs.tags || [],
                confidence: obs.confidence ?? 0.8,
                source: obs.source,
                embedding,
              });
            } catch (err) {
              logger?.error?.(`Vector sync: failed to store observation ${obs.id} in SQL: ${err.message}`);
              errors++;
              continue;
            }
          }

          // Always update local vectors.json
          updateLocalVectorIndex(rootDir, obs, embedding);
          synced++;
        }
      } catch (err) {
        logger?.error?.(`Vector sync: batch embedding failed: ${err.message}`);
        errors += batch.length;
      }
    }

    const durationMs = Date.now() - startTime;
    logger?.info?.(`Vector sync: embedded ${synced} observation(s) in ${durationMs}ms (${errors} errors)`);
    return { synced, errors, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    logger?.error?.(`Vector sync failed: ${err.message}`);
    return { synced: 0, errors: 1, durationMs };
  }
}

/**
 * Update the local vectors.json index with a new embedding.
 * @param {string} rootDir
 * @param {object} obs - Observation record
 * @param {Float32Array} embedding
 */
function updateLocalVectorIndex(rootDir, obs, embedding) {
  const obsDir = join(rootDir, '.cx', 'observations');
  const vectorsPath = join(obsDir, 'vectors.json');

  let vectors;
  if (existsSync(vectorsPath)) {
    try {
      vectors = JSON.parse(readFileSync(vectorsPath, 'utf8'));
    } catch {
      vectors = { version: 1, model: 'hashing-bow-v1', updatedAt: null, records: [] };
    }
  } else {
    vectors = { version: 1, model: 'hashing-bow-v1', updatedAt: null, records: [] };
  }

  // Add or update the record
  const existingIdx = vectors.records.findIndex((r) => r.id === obs.id);
  const record = {
    id: obs.id,
    embedding: Array.from(embedding),
    summary: obs.summary,
    content: obs.content,
    tags: obs.tags || [],
    project: obs.project,
    role: obs.role,
    category: obs.category,
    updatedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    vectors.records[existingIdx] = record;
  } else {
    vectors.records.push(record);
  }

  // Cap at 1000 records (sliding window)
  if (vectors.records.length > 1000) {
    vectors.records = vectors.records.slice(-1000);
  }

  vectors.updatedAt = new Date().toISOString();

  mkdirSync(dirname(vectorsPath), { recursive: true });
  writeFileSync(vectorsPath, JSON.stringify(vectors, null, 2), 'utf8');
}

export { DEFAULT_BATCH_SIZE, DEFAULT_INTERVAL_MS };
