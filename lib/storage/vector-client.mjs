/**
 * lib/storage/vector-client.mjs — Unified vector storage client for LanceDB.
 *
 * Hides whether we're using local LanceDB files or (future) external LanceDB Cloud.
 * All callers use: storeObservation(id, data), searchObservations(query, filters), etc.
 *
 * This implementation replaces the legacy pgvector client with a local-first,
 * embedded columnar store. It remains local to the machine (.cx/lancedb) and
 * is designed to be paired with Git-backed facts in .cx/shared-knowledge/.
 *
 * NOTE: @lancedb/lancedb and apache-arrow are imported lazily to avoid
 * ERR_MODULE_NOT_FOUND in environments where they are not installed.
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import { getEmbeddingModelInfo } from './embeddings-engine.mjs';

const FALLBACK_DIMENSIONS = 384;

/**
 * Returns the path to the local LanceDB storage.
 */
function getDbPath(env = process.env) {
  // Respect CONSTRUCT_LANCEDB_PATH if set, otherwise default to .cx/lancedb
  if (env.CONSTRUCT_LANCEDB_PATH) return env.CONSTRUCT_LANCEDB_PATH;
  return path.join(process.cwd(), '.cx', 'lancedb');
}

export class VectorClient {
  constructor({ databaseUrl, env } = {}) {
    // databaseUrl is ignored in the new LanceDB implementation for now,
    // but kept for interface compatibility with the old VectorClient.
    this.env = env || process.env;
    this._db = null;
    this._lancedbModule = null;
    this._arrowModule = null;
    this._engineDim = null;
  }

  async _initModules() {
    if (this._lancedbModule && this._arrowModule) return;
    try {
      this._lancedbModule = await import('@lancedb/lancedb');
      this._arrowModule = await import('apache-arrow');
    } catch (err) {
      throw new Error(
        `Failed to load LanceDB or Apache Arrow: ${err.message}. ` +
        `Ensure they are installed (npm install @lancedb/lancedb apache-arrow).`
      );
    }
  }

  async _getDb() {
    if (this._db) return this._db;
    await this._initModules();
    const dbPath = getDbPath(this.env);
    if (!fs.existsSync(dbPath)) {
      fs.mkdirSync(dbPath, { recursive: true });
    }
    this._db = await this._lancedbModule.connect(dbPath);
    return this._db;
  }

  async getEngineDimensions() {
    if (this._engineDim != null) return this._engineDim;
    try {
      const info = await getEmbeddingModelInfo({ env: this.env });
      this._engineDim = info.dimensions;
    } catch {
      this._engineDim = FALLBACK_DIMENSIONS;
    }
    return this._engineDim;
  }

  /**
   * LanceDB handles schema dynamically, but we can enforce it via Apache Arrow.
   */
  async _getObservationsTable() {
    const db = await this._getDb();
    const tableName = 'construct_observations';
    const dim = await this.getEngineDimensions();

    try {
      return await db.openTable(tableName);
    } catch {
      // Create table if it doesn't exist
      const schema = new this._arrowModule.Schema([
        new this._arrowModule.Field('id', new this._arrowModule.Utf8()),
        new this._arrowModule.Field('project', new this._arrowModule.Utf8()),
        new this._arrowModule.Field('role', new this._arrowModule.Utf8()),
        new this._arrowModule.Field('category', new this._arrowModule.Utf8()),
        new this._arrowModule.Field('summary', new this._arrowModule.Utf8()),
        new this._arrowModule.Field('content', new this._arrowModule.Utf8()),
        new this._arrowModule.Field('tags', new this._arrowModule.Utf8()), // JSON string
        new this._arrowModule.Field('confidence', new this._arrowModule.Float32()),
        new this._arrowModule.Field('source', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('git_sha', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('embedding', new this._arrowModule.FixedSizeList(dim, new this._arrowModule.Field('item', new this._arrowModule.Float32()))),
        new this._arrowModule.Field('content_hash', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('model', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('created_at', new this._arrowModule.Timestamp(this._arrowModule.TimeUnit.MILLISECOND), true),
        new this._arrowModule.Field('updated_at', new this._arrowModule.Timestamp(this._arrowModule.TimeUnit.MILLISECOND), true),
      ]);
      return await db.createTable(tableName, [], { schema });
    }
  }

  async _getDocumentsTable() {
    const db = await this._getDb();
    const tableName = 'construct_documents';
    const dim = await this.getEngineDimensions();

    try {
      return await db.openTable(tableName);
    } catch {
      const schema = new this._arrowModule.Schema([
        new this._arrowModule.Field('id', new this._arrowModule.Utf8()),
        new this._arrowModule.Field('project', new this._arrowModule.Utf8()),
        new this._arrowModule.Field('kind', new this._arrowModule.Utf8()),
        new this._arrowModule.Field('title', new this._arrowModule.Utf8()),
        new this._arrowModule.Field('summary', new this._arrowModule.Utf8()),
        new this._arrowModule.Field('body', new this._arrowModule.Utf8()),
        new this._arrowModule.Field('source_path', new this._arrowModule.Utf8()),
        new this._arrowModule.Field('tags', new this._arrowModule.Utf8()),
        new this._arrowModule.Field('content_hash', new this._arrowModule.Utf8()),
        new this._arrowModule.Field('embedding', new this._arrowModule.FixedSizeList(dim, new this._arrowModule.Field('item', new this._arrowModule.Float32()))),
        new this._arrowModule.Field('model', new this._arrowModule.Utf8()),
        new this._arrowModule.Field('created_at', new this._arrowModule.Timestamp(this._arrowModule.TimeUnit.MILLISECOND), true),
        new this._arrowModule.Field('updated_at', new this._arrowModule.Timestamp(this._arrowModule.TimeUnit.MILLISECOND), true),
      ]);
      return await db.createTable(tableName, [], { schema });
    }
  }

  async isHealthy() {
    try {
      await this._getDb();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * For interface compatibility. LanceDB always has "vector" support if loaded.
   */
  async isPgvectorEnabled() {
    return this.isHealthy();
  }

  async storeObservation({ id, project, role, category, summary, content, tags, confidence, source, embedding, gitSha, contentHash = null, model = null }) {
    const table = await this._getObservationsTable();
    const now = Date.now();
    
    const record = {
      id,
      project,
      role,
      category,
      summary,
      content,
      tags: JSON.stringify(tags || []),
      confidence: confidence || 0.8,
      source: source || '',
      git_sha: gitSha || '',
      embedding: Array.from(embedding),
      content_hash: contentHash || '',
      model: model || '',
      created_at: now,
      updated_at: now
    };

    // LanceDB mergeInsert (upsert)
    await table.mergeInsert('id').whenMatchedUpdate({ 
      updateVars: {
        summary: 'summary',
        content: 'content',
        tags: 'tags',
        confidence: 'confidence',
        source: 'source',
        git_sha: 'git_sha',
        embedding: 'embedding',
        content_hash: 'content_hash',
        model: 'model',
        updated_at: 'updated_at'
      }
    }).execute([record]);

    return { mode: 'lancedb', id };
  }

  async getObservationFingerprints(ids = []) {
    const table = await this._getObservationsTable();
    if (!Array.isArray(ids) || ids.length === 0) return new Map();
    
    // LanceDB filtering
    const results = await table.query()
      .where(`id IN (${ids.map(id => `'${id}'`).join(',')})`)
      .select(['id', 'content_hash', 'model'])
      .toArray();

    return new Map(results.map((r) => [r.id, { contentHash: r.content_hash, model: r.model }]));
  }

  async searchObservations({ project, queryEmbedding, limit = 10, minSimilarity = 0.3, role, category }) {
    const table = await this._getObservationsTable();
    
    let query = table.search(Array.from(queryEmbedding))
      .metricType('cosine')
      .limit(limit);

    // Apply filters
    const filters = [`project = '${project}'`];
    if (role) filters.push(`role = '${role}'`);
    if (category) filters.push(`category = '${category}'`);
    
    query = query.where(filters.join(' AND '));

    const results = await query.toArray();
    
    // LanceDB .search() returns _distance (L2) or we can use cosine. 
    // LanceDB distance for cosine is 1 - similarity.
    return results.map(r => ({
      ...r,
      similarity: 1 - r._distance,
      tags: JSON.parse(r.tags || '[]')
    })).filter(r => r.similarity > minSimilarity);
  }

  async storeDocument({ id, project, kind, title, summary, body, sourcePath, tags, contentHash, embedding, model }) {
    const table = await this._getDocumentsTable();
    const now = Date.now();
    
    if (!model) {
      const info = await getEmbeddingModelInfo({ env: this.env });
      model = info.model;
    }

    const record = {
      id,
      project,
      kind,
      title,
      summary: summary || '',
      body,
      source_path: sourcePath || '',
      tags: JSON.stringify(tags || []),
      content_hash: contentHash || '',
      embedding: Array.from(embedding),
      model,
      created_at: now,
      updated_at: now
    };

    await table.mergeInsert('id').whenMatchedUpdate({
      updateVars: {
        title: 'title',
        summary: 'summary',
        body: 'body',
        source_path: 'source_path',
        tags: 'tags',
        content_hash: 'content_hash',
        embedding: 'embedding',
        model: 'model',
        updated_at: 'updated_at'
      }
    }).execute([record]);

    return { mode: 'lancedb', id };
  }

  async searchDocuments({ project, queryEmbedding, limit = 10, minSimilarity = 0.3 }) {
    const table = await this._getDocumentsTable();
    
    const results = await table.search(Array.from(queryEmbedding))
      .metricType('cosine')
      .where(`project = '${project}'`)
      .limit(limit)
      .toArray();

    return results.map(r => ({
      ...r,
      similarity: 1 - r._distance,
      tags: JSON.parse(r.tags || '[]')
    })).filter(r => r.similarity > minSimilarity);
  }

  async close() {
    // LanceDB connections don't strictly need closing in the same way 
    // as Postgres pools, but we'll null it out.
    this._db = null;
  }
}
