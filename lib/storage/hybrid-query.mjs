#!/usr/bin/env node
/**
 * lib/storage/hybrid-query.mjs — hybrid file + SQL + semantic retrieval.
 */
import { loadStateSnapshot, summarizeStateSnapshot } from './state-source.mjs';
import { describeSqlStore } from './sql-store.mjs';
import { describeVectorStore, searchLocalVectorIndex, vectorSearchLocal } from './vector-store.mjs';
import { createSqlClient, closeSqlClient, readVectorConfig } from './backend.mjs';
import { embedText, getEmbeddingModelInfo } from './embeddings-engine.mjs';
import { floatArrayToPgVector } from './vector-client.mjs';
import { reciprocalRankFusion } from './rrf.mjs';

// iterative_scan (pgvector >= 0.8.0) keeps a filtered ANN query from
// under-returning; harmless for the current unfiltered query, and the correct
// default once tag/metadata filters are added to the vector search.

async function supportsIterativeScan(client) {
  try {
    const [row] = await client`SELECT extversion AS v FROM pg_extension WHERE extname = 'vector'`;
    if (!row?.v) return false;
    const [major, minor] = String(row.v).split('.').map((n) => parseInt(n, 10));
    return major > 0 || (major === 0 && minor >= 8);
  } catch {
    return false;
  }
}

function collectFileCandidates(snapshot) {
  const docs = [];

  if (snapshot.context) {
    docs.push({
      id: '.cx/context.json',
      kind: 'context',
      title: 'Context state',
      summary: snapshot.context.contextSummary || snapshot.context.summary || null,
      body: JSON.stringify(snapshot.context, null, 2),
      tags: ['context', 'state', 'cx'],
    });
  }

  if (snapshot.architecture) {
    docs.push({
      id: 'docs/concepts/architecture.md',
      kind: 'architecture',
      title: 'Architecture docs',
      summary: snapshot.architecture.slice(0, 240),
      body: snapshot.architecture,
      tags: ['architecture', 'docs'],
    });
  }

  if (snapshot.docsReadme) {
    docs.push({
      id: 'docs/README.md',
      kind: 'docs',
      title: 'Docs index',
      summary: snapshot.docsReadme.slice(0, 240),
      body: snapshot.docsReadme,
      tags: ['docs', 'index'],
    });
  }

  for (const doc of snapshot.productIntelDocs ?? []) {
    const kind = doc.path.startsWith('docs/prd/')
      ? 'prd'
      : doc.path.startsWith('docs/meta-prd/')
        ? 'meta-prd'
        : 'knowledge';
    docs.push({
      id: doc.path,
      kind,
      title: doc.title,
      summary: doc.body.slice(0, 240),
      body: doc.body,
      tags: ['knowledge', kind],
    });
  }

  return docs;
}

export function buildHybridSearchResults(rootDir, query, { limit = 10, env = process.env } = {}) {
  const snapshot = loadStateSnapshot(rootDir);
  const fileCandidates = collectFileCandidates(snapshot);
  const sqlStore = describeSqlStore(env);
  const vectorStore = describeVectorStore(env);
  const fileHits = vectorSearchLocal(fileCandidates, query, { limit });
  const localVectorHits = vectorStore.mode === 'local' && vectorStore.indexPath
    ? searchLocalVectorIndex(vectorStore.indexPath, query, { limit })
    : [];
  const merged = [...fileHits];
  for (const hit of localVectorHits) {
    if (merged.some((entry) => entry.id === hit.id)) continue;
    merged.push({
      id: hit.id,
      kind: hit.kind,
      title: hit.title,
      summary: hit.summary,
      score: hit.score,
      source_path: hit.source_path,
    });
  }

  return {
    query,
    summary: summarizeStateSnapshot(snapshot),
    stores: {
      file: { configured: true, mode: 'canonical' },
      sql: sqlStore,
      vector: vectorStore,
    },
    results: merged.slice(0, limit).map((hit) => ({
      id: hit.id,
      kind: hit.kind,
      title: hit.title,
      summary: hit.summary,
      score: hit.score,
    })),
  };
}

export async function buildHybridSearchResultsAsync(rootDir, query, { limit = 10, env = process.env, embed = embedText, embeddingModel: modelOverride = null } = {}) {
  const base = buildHybridSearchResults(rootDir, query, { limit, env });
  const client = createSqlClient(env);
  if (!client) return base;

  // Resolve the active embedding model so the SQL filter and the query
  // embedding agree on dimensionality and identity.
  const embeddingModel = modelOverride || (await getEmbeddingModelInfo({ env })).model;

  try {
    const queryVec = floatArrayToPgVector((await embed(query, { env })).embedding);
    const iterative = await supportsIterativeScan(client);

    // Native pgvector ANN over the HNSW index (not a JS full scan). When the
    // extension supports it, relaxed_order iterative scan runs inside the txn.
    const runVector = (sql) => sql`
      select d.id, d.kind, d.title, d.summary, d.source_path
      from construct_documents d
      join construct_embeddings e on e.document_id = d.id
      where d.project = 'construct' and e.model = ${embeddingModel}
      order by e.embedding <=> ${queryVec}
      limit ${limit}
    `;
    const vectorHits = iterative
      ? await client.begin(async (sql) => {
          await sql`SET LOCAL hnsw.iterative_scan = relaxed_order`;
          return runVector(sql);
        })
      : await runVector(client);

    const keywordHits = await client`
      select id, kind, title, summary, source_path
      from construct_documents
      where project = 'construct'
        and (title ilike ${`%${query}%`} or coalesce(summary, '') ilike ${`%${query}%`} or body ilike ${`%${query}%`})
      order by updated_at desc
      limit ${limit}
    `;

    // One consolidated ranking: file BM25 (base) + neural ANN + keyword, fused
    // by Reciprocal Rank Fusion so three incompatible score scales merge by
    // rank rather than magnitude.
    const lists = [base.results, vectorHits, keywordHits];
    const byId = new Map();
    for (const list of lists) {
      for (const it of list) if (it && !byId.has(it.id)) byId.set(it.id, it);
    }
    const results = reciprocalRankFusion(lists, { idOf: (x) => x.id, limit }).map(({ id, score }) => {
      const it = byId.get(id);
      return { id, kind: it.kind, title: it.title, summary: it.summary, score, source_path: it.source_path ?? null };
    });

    return {
      ...base,
      results,
      stores: {
        ...base.stores,
        vector: {
          ...base.stores.vector,
          ...readVectorConfig(env),
          model: embeddingModel,
          iterativeScan: iterative,
        },
        sql: {
          ...base.stores.sql,
          mode: 'postgres',
          configured: true,
          sharedReady: true,
        },
      },
    };
  } catch (error) {
    return {
      ...base,
      error: error?.message || 'hybrid search failed',
    };
  } finally {
    await closeSqlClient(client);
  }
}
