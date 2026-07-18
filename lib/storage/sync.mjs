#!/usr/bin/env node
/**
 * lib/storage/sync.mjs — sync file-state artifacts into the active retrieval adapter's index.
 *
 * Syncs into the active retrieval adapter (lib/storage/retrieval-adapter.mjs:
 * LanceDB when reachable, the dependency-free keyword/BM25 adapter otherwise),
 * matching the local-first, Git-backed architecture.
 */
import crypto from 'node:crypto';
import { loadStateSnapshot } from './state-source.mjs';
import { embedBatch, getEmbeddingModelInfo } from './embeddings-engine.mjs';
import { createRetrievalAdapter } from './retrieval-adapter.mjs';

function hashContent(content) {
  return crypto.createHash('sha256').update(String(content || '')).digest('hex');
}

function toDocumentRows(rootDir, snapshot, project = 'construct') {
  const rows = [];

  if (snapshot.context) {
    const body = JSON.stringify(snapshot.context, null, 2);
    rows.push({
      id: `${project}:context`,
      project,
      kind: 'context',
      title: 'Context state',
      summary: snapshot.context.contextSummary || snapshot.context.summary || '',
      body,
      source_path: '.construct/context.json',
      tags: ['context', 'state', 'construct'],
      content_hash: hashContent(body),
    });
  }

  if (snapshot.architecture) {
    const body = snapshot.architecture;
    rows.push({
      id: `${project}:architecture`,
      project,
      kind: 'architecture',
      title: 'Architecture docs',
      summary: body.slice(0, 240),
      body,
      source_path: 'docs/guides/concepts/architecture.md',
      tags: ['architecture', 'docs'],
      content_hash: hashContent(body),
    });
  }

  if (snapshot.docsReadme) {
    const body = snapshot.docsReadme;
    rows.push({
      id: `${project}:docs-readme`,
      project,
      kind: 'docs',
      title: 'Docs index',
      summary: body.slice(0, 240),
      body,
      source_path: 'docs/README.md',
      tags: ['docs', 'index'],
      content_hash: hashContent(body),
    });
  }

  for (const doc of snapshot.productIntelDocs ?? []) {
    const body = doc.body;
    const rel = doc.path;
    const kind = rel.startsWith('docs/specs/prd/')
      ? 'prd'
      : rel.startsWith('docs/meta-prd/')
        ? 'meta-prd'
        : 'knowledge';
    rows.push({
      id: `${project}:${rel}`,
      project,
      kind,
      title: doc.title,
      summary: body.slice(0, 240),
      body,
      source_path: rel,
      tags: ['knowledge', kind],
      content_hash: hashContent(body),
    });
  }

  return rows;
}

export async function syncFileStateToSql(rootDir, { env = process.env, project = 'construct' } = {}) {
  const snapshot = await loadStateSnapshot(rootDir);
  const rows = toDocumentRows(rootDir, snapshot, project);
  
  const modelInfo = await getEmbeddingModelInfo({ env });
  const embeddingModel = modelInfo.model;

  const adapter = await createRetrievalAdapter({ env, rootDir });

  if (rows.length === 0) {
    return {
      status: 'ok',
      documentsSynced: 0,
      embeddingsSynced: 0,
      embeddingModel,
      backend: adapter.mode
    };
  }

  // Batch-embed all documents
  const embedTexts = rows.map((row) =>
    [row.title, row.summary, row.body, row.source_path, row.kind].filter(Boolean).join('\n')
  );
  const embeddings = await embedBatch(embedTexts, { env });

  let documentsSynced = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    await adapter.storeDocument({
      ...row,
      embedding: embeddings[i].embedding,
      model: embeddingModel
    });
    documentsSynced += 1;
  }

  return {
    status: 'ok',
    documentsSynced,
    embeddingsSynced: documentsSynced,
    embeddingModel,
    backend: adapter.mode
  };
}
