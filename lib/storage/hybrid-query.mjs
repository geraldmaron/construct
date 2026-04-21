#!/usr/bin/env node
/**
 * lib/storage/hybrid-query.mjs — hybrid file + SQL + semantic retrieval.
 */
import { loadStateSnapshot, summarizeStateSnapshot } from './state-source.mjs';
import { describeSqlStore } from './sql-store.mjs';
import { describeVectorStore, searchLocalVectorIndex, vectorSearchLocal } from './vector-store.mjs';
import { createSqlClient, closeSqlClient, readVectorConfig } from './backend.mjs';
import { EMBEDDING_MODEL, embedText, scoreEmbeddedDocuments } from './embeddings.mjs';

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

  if (snapshot.workflow) {
    docs.push({
      id: '.cx/workflow.json',
      kind: 'workflow',
      title: snapshot.workflow.title || 'Workflow state',
      summary: snapshot.workflow.summary || null,
      body: JSON.stringify(snapshot.workflow, null, 2),
      tags: ['workflow', 'state', 'cx'],
    });
  }

  if (snapshot.architecture) {
    docs.push({
      id: 'docs/architecture.md',
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
        : 'product-intel';
    docs.push({
      id: doc.path,
      kind,
      title: doc.title,
      summary: doc.body.slice(0, 240),
      body: doc.body,
      tags: ['product-intel', kind],
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

export async function buildHybridSearchResultsAsync(rootDir, query, { limit = 10, env = process.env } = {}) {
  const base = buildHybridSearchResults(rootDir, query, { limit, env });
  const client = createSqlClient(env);
  if (!client) return base;

  try {
    const embeddingRows = await client`
      select d.id, d.kind, d.title, d.summary, d.body, d.source_path, d.tags, e.embedding
      from construct_documents d
      join construct_embeddings e on e.document_id = d.id
      where d.project = 'construct' and e.model = ${EMBEDDING_MODEL}
    `;

    const embeddedHits = scoreEmbeddedDocuments(
      embeddingRows.map((row) => ({
        ...row,
        embedding: row.embedding,
      })),
      query,
      { limit },
    );

    const sqlHits = await client`
      select id, kind, title, summary, body, source_path
      from construct_documents
      where project = 'construct'
        and (title ilike ${`%${query}%`} or coalesce(summary, '') ilike ${`%${query}%`} or body ilike ${`%${query}%`})
      order by updated_at desc
      limit ${limit}
    `;

    const merged = [...base.results];
    for (const hit of embeddedHits) {
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
    for (const hit of sqlHits) {
      if (merged.some((entry) => entry.id === hit.id)) continue;
      merged.push({
        id: hit.id,
        kind: hit.kind,
        title: hit.title,
        summary: hit.summary,
        score: 1,
        source_path: hit.source_path,
      });
    }

    return {
      ...base,
      results: merged.slice(0, limit),
      stores: {
        ...base.stores,
        vector: {
          ...base.stores.vector,
          ...readVectorConfig(env),
          model: EMBEDDING_MODEL,
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
