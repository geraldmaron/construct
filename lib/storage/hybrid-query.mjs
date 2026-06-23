/**
 * lib/storage/hybrid-query.mjs — unified search across knowledge and facts.
 *
 * Stub for the LanceDB-backed search.
 */
import { VectorClient } from './vector-client.mjs';

export async function buildHybridSearchResultsAsync(rootDir, query, { limit = 10, env = process.env } = {}) {
  // Embed the query

  const { embedText } = await import('./embeddings-engine.mjs');
  const { embedding } = await embedText(query, { env });

  // Search LanceDB documents and observations

  const client = new VectorClient({ env });
  const docs = await client.searchDocuments({ project: 'construct', queryEmbedding: embedding, limit });
  const obs = await client.searchObservations({ project: 'construct', queryEmbedding: embedding, limit });

  // Merge both result sets and rank by similarity

  const all = [...docs.map(d => ({ ...d, type: 'document' })), ...obs.map(o => ({ ...o, type: 'observation' }))];
  return all.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}
