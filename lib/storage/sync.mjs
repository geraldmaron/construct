#!/usr/bin/env node
/**
 * lib/storage/sync.mjs — sync file-state artifacts into shared Postgres indices.
 */
import crypto from 'node:crypto';
import { loadStateSnapshot } from './state-source.mjs';
import { createSqlClient, closeSqlClient, readVectorConfig } from './backend.mjs';
import { embedBatch, getEmbeddingModelInfo } from './embeddings-engine.mjs';
import { writeLocalVectorIndex } from './vector-store.mjs';
import { runMigrations } from './migrations.mjs';

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
      summary: snapshot.context.contextSummary || snapshot.context.summary || null,
      body,
      source_path: '.cx/context.json',
      tags: ['context', 'state', 'cx'],
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
      source_path: 'docs/architecture.md',
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
    const kind = rel.startsWith('docs/prd/')
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

/**
 * Ensure the hybrid storage schema is current by running every pending
 * migration in order. Replaces the previous one-shot `001_init.sql` runner;
 * the new path uses `lib/storage/migrations.mjs` which tracks applied state
 * in `construct_schema_migrations` and surfaces drift on changed files.
 */
export async function ensureHybridSchema(client) {
  await runMigrations(client);
}

export async function syncFileStateToSql(rootDir, { env = process.env, project = 'construct' } = {}) {
  const snapshot = loadStateSnapshot(rootDir);
  const rows = toDocumentRows(rootDir, snapshot, project);
  const vectorConfig = readVectorConfig(env);

  // Resolve the active embedding model once per sync so every record carries
  // a consistent model id and dimensionality.
  const modelInfo = await getEmbeddingModelInfo({ env });
  const embeddingModel = modelInfo.model;

  // Batch-embed all documents through the engine. The engine selects the
  // configured adapter (local ONNX, openai, ollama, hashing) and returns
  // Float32Array embeddings of `modelInfo.dimensions` length.
  const embedTexts = rows.map((row) =>
    [row.title, row.summary, row.body, row.source_path, row.kind].filter(Boolean).join('\n')
  );
  const embeddings = embedTexts.length > 0 ? await embedBatch(embedTexts, { env }) : [];

  const localVectorRecords = rows.map((row, i) => ({
    id: row.id,
    project: row.project,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    body: row.body,
    source_path: row.source_path,
    tags: row.tags,
    content_hash: row.content_hash,
    embedding: Array.from(embeddings[i].embedding),
    updatedAt: new Date().toISOString(),
  }));

  let localVector = { status: 'unavailable', note: 'No local vector index configured', recordsSynced: 0 };
  if (vectorConfig.indexPath) {
    const payload = writeLocalVectorIndex(vectorConfig.indexPath, localVectorRecords, { model: embeddingModel });
    localVector = {
      status: 'ok',
      indexPath: vectorConfig.indexPath,
      model: payload.model,
      recordsSynced: payload.records.length,
      updatedAt: payload.updatedAt,
    };
  }

  const client = createSqlClient(env);
  if (!client) {
    return {
      status: localVector.status === 'ok' ? 'ok' : 'unavailable',
      note: 'No DATABASE_URL configured',
      documentsSynced: rows.length,
      embeddingsSynced: localVector.recordsSynced,
      embeddingModel,
      vector: vectorConfig,
      localVector,
      sql: { status: 'unavailable', note: 'No DATABASE_URL configured' },
    };
  }

  try {
    await ensureHybridSchema(client);

    let documentsSynced = 0;
    let embeddingsSynced = 0;
    for (const row of rows) {
      await client`
        insert into construct_documents (id, project, kind, title, summary, body, source_path, tags, content_hash, updated_at)
        values (${row.id}, ${row.project}, ${row.kind}, ${row.title}, ${row.summary}, ${row.body}, ${row.source_path}, ${JSON.stringify(row.tags)}, ${row.content_hash}, now())
        on conflict (id) do update set
          project = excluded.project,
          kind = excluded.kind,
          title = excluded.title,
          summary = excluded.summary,
          body = excluded.body,
          source_path = excluded.source_path,
          tags = excluded.tags,
          content_hash = excluded.content_hash,
          updated_at = now()
      `;
      documentsSynced += 1;

      const embedding = localVectorRecords[documentsSynced - 1].embedding;
      await client`
        insert into construct_embeddings (document_id, model, embedding, content_hash, updated_at)
        values (${row.id}, ${embeddingModel}, ${embedding}, ${row.content_hash}, now())
        on conflict (document_id) do update set
          model = excluded.model,
          embedding = excluded.embedding,
          content_hash = excluded.content_hash,
          updated_at = now()
      `;
      embeddingsSynced += 1;
    }

    await client`
      insert into construct_sync_runs (project, source, documents_synced, embeddings_synced, status, note)
      values (${project}, ${'file-state'}, ${documentsSynced}, ${0}, ${'ok'}, ${'synced file-state documents'})
    `;

    return {
      status: 'ok',
      documentsSynced,
      embeddingsSynced,
      embeddingModel,
      vector: vectorConfig,
      localVector,
      sql: { status: 'ok' },
    };
  } catch (error) {
    return {
      status: localVector.status === 'ok' ? 'degraded' : 'degraded',
      error: error?.message || 'sync failed',
      documentsSynced: rows.length,
      embeddingsSynced: localVector.recordsSynced,
      embeddingModel,
      vector: vectorConfig,
      localVector,
      sql: { status: 'degraded', error: error?.message || 'sync failed' },
    };
  } finally {
    await closeSqlClient(client);
  }
}
