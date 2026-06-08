/**
 * lib/storage/hybrid-query.mjs — unified search across knowledge and facts.
 *
 * This is a stub for the new LanceDB-backed search. 
 */
import { VectorClient } from './vector-client.mjs';

export async function buildHybridSearchResultsAsync(rootDir, query, { limit = 10, env = process.env } = {}) {
  // 1. Embed query
  const { embedText } = await import('./embeddings-engine.mjs');
  const { embedding } = await embedText(query, { env });

  // 2. Search LanceDB
  const client = new VectorClient({ env });
  const docs = await client.searchDocuments({ project: 'construct', queryEmbedding: embedding, limit });
  const obs = await client.searchObservations({ project: 'construct', queryEmbedding: embedding, limit });

  // 3. Merge and rank (simple merge for now)
  const all = [...docs.map(d => ({ ...d, type: 'document' })), ...obs.map(o => ({ ...o, type: 'observation' }))];
  return all.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}
