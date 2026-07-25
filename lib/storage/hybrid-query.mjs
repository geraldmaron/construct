/**
 * lib/storage/hybrid-query.mjs — unified search across knowledge and facts.
 *
 * Stub for the retrieval-adapter-backed search (lib/storage/retrieval-adapter.mjs):
 * LanceDB when reachable, the dependency-free keyword/BM25 adapter otherwise.
 * Results pass through the N4 retrieval-hardening pipeline
 * (lib/storage/retrieval-hardening.mjs) before being returned, so poisoning
 * defenses (trust-weighted ranking, per-source recall cap, similarity sanity
 * threshold, duplicate collapse) apply to every hybrid-query caller uniformly
 * regardless of which adapter served the results.
 */
import { resolveKnowledgeStoreSelection } from '../engine/knowledge-store-contract.mjs';
import { createRetrievalAdapter } from './retrieval-adapter.mjs';
import { hardenRetrieval } from './retrieval-hardening.mjs';
import { inferProjectName } from './admin.mjs';

export async function buildHybridSearchResultsAsync(rootDir, query, { limit = 10, env = process.env } = {}) {
  const selection = await resolveKnowledgeStoreSelection({ env, rootDir });
  const adapterEnv = selection.mode === 'minimal-local'
    ? { ...env, CONSTRUCT_RETRIEVAL_ADAPTER: 'keyword' }
    : env;

  const { embedText } = await import('./embeddings-engine.mjs');
  const { embedding } = await embedText(query, { env });

  // Ingest and sync store rows under inferProjectName(cwd); querying with a
  // hardcoded project name silently returns [] for every other project.

  const project = inferProjectName(rootDir);
  const client = await createRetrievalAdapter({ env: adapterEnv, rootDir });
  const docs = await client.searchDocuments({ project, queryEmbedding: embedding, query, limit });
  const obs = await client.searchObservations({ project, queryEmbedding: embedding, query, limit });

  // Merge both result sets, then rank by similarity, provenance, and recall
  // caps rather than similarity alone — an adversarial embedding tuned for
  // top cosine similarity must not dominate assembled context.

  const all = [...docs.map(d => ({ ...d, type: 'document' })), ...obs.map(o => ({ ...o, type: 'observation' }))];
  const ranked = all.sort((a, b) => b.similarity - a.similarity);
  return hardenRetrieval(ranked, { limit });
}
