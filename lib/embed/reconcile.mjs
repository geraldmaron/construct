/**
 * lib/embed/reconcile.mjs — bring the Postgres observation index back in sync
 * with the local source of truth.
 *
 * Observations are embedded inline on write (lib/observation-store.mjs), but
 * the inline write is skipped whenever Postgres is unreachable at creation time
 * (the local hashing-bow fallback is used instead), and a model change leaves
 * every prior row embedded in a stale vector space. This pass is the safety
 * net: for each local observation it compares the (content_hash, model) the
 * pg row was embedded with against the live content + current model, and
 * re-embeds ONLY the rows that are missing or stale. Idempotent — a second run
 * with no changes re-embeds nothing.
 *
 * Reconciliation-on-sync is preferred over a fixed-interval polling cron (see
 * docs/research/vector-search-best-practices.md): the pass runs where Construct
 * already touches storage (the model-change re-embed, the storage CLI), keys
 * idempotency on a content hash, and re-embeds on model change.
 */

import { VectorClient } from '../storage/vector-client.mjs';
import { embedText as embedTextEngine, getEmbeddingModelInfo } from '../storage/embeddings-engine.mjs';
import { listObservations, getObservation, observationSearchText, observationContentHash } from '../observation-store.mjs';

export async function reconcileObservationEmbeddings(rootDir, { env = process.env, limit = Infinity, embed = embedTextEngine, modelId = null } = {}) {
  const client = new VectorClient({ env });
  const result = { checked: 0, reembedded: 0, model: null, skipped: null };

  try {
    if (!(await client.isHealthy())) {
      result.skipped = 'unhealthy';
      return result;
    }

    const currentModel = modelId || (await getEmbeddingModelInfo({ env })).model;
    result.model = currentModel;

    const ids = (listObservations(rootDir, { limit: Number.MAX_SAFE_INTEGER }) || []).map((e) => e.id);
    const fingerprints = await client.getObservationFingerprints(ids);

    for (const id of ids) {
      if (result.reembedded >= limit) break;
      const obs = getObservation(rootDir, id);
      if (!obs) continue;
      result.checked += 1;

      const searchText = observationSearchText(obs);
      const hash = observationContentHash(searchText);
      const fp = fingerprints.get(id);
      if (fp && fp.contentHash === hash && fp.model === currentModel) continue;

      const { embedding, model } = await embed(searchText, { env });
      await client.storeObservation({ ...obs, embedding, contentHash: hash, model: model || currentModel });
      result.reembedded += 1;
    }

    return result;
  } finally {
    await client.close();
  }
}
