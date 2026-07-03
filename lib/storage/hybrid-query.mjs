/**
 * lib/storage/hybrid-query.mjs — unified search across knowledge and facts.
 *
 * Stub for the LanceDB-backed search. Results pass through the N4
 * retrieval-hardening pipeline (lib/storage/retrieval-hardening.mjs) before
 * being returned, so vector-store poisoning defenses (trust-weighted
 * ranking, per-source recall cap, similarity sanity threshold, duplicate
 * collapse) apply to every hybrid-query caller uniformly.
 */
import { VectorClient } from './vector-client.mjs';
import { hardenRetrieval } from './retrieval-hardening.mjs';

export async function buildHybridSearchResultsAsync(rootDir, query, { limit = 10, env = process.env } = {}) {
  // Embed the query

  const { embedText } = await import('./embeddings-engine.mjs');
  const { embedding } = await embedText(query, { env });

  // Search LanceDB documents and observations

  const client = new VectorClient({ env });
  const docs = await client.searchDocuments({ project: 'construct', queryEmbedding: embedding, limit });
  const obs = await client.searchObservations({ project: 'construct', queryEmbedding: embedding, limit });

  // Merge both result sets, then rank by similarity, provenance, and recall
  // caps rather than similarity alone — an adversarial embedding tuned for
  // top cosine similarity must not dominate assembled context.

  const all = [...docs.map(d => ({ ...d, type: 'document' })), ...obs.map(o => ({ ...o, type: 'observation' }))];
  const ranked = all.sort((a, b) => b.similarity - a.similarity);
  return hardenRetrieval(ranked, { limit });
}
