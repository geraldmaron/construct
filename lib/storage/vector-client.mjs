/**
 * lib/storage/vector-client.mjs — Unified vector storage client for LanceDB.
 */

import path from 'path';
import fs from 'fs';
import { getEmbeddingModelInfo } from './embeddings-engine.mjs';

const FALLBACK_DIMENSIONS = 384;

function getDbPath(env = process.env) {
  if (env.CONSTRUCT_LANCEDB_PATH) return env.CONSTRUCT_LANCEDB_PATH;
  return path.join(process.cwd(), '.cx', 'lancedb');
}

export class VectorClient {
  constructor({ databaseUrl, env } = {}) {
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

  async _getObservationsTable() {
    const db = await this._getDb();
    const tableName = 'observations_v1';
    const dim = await this.getEngineDimensions();

    try {
      return await db.openTable(tableName);
    } catch {
      const schema = new this._arrowModule.Schema([
        new this._arrowModule.Field('id', new this._arrowModule.Utf8()),
        new this._arrowModule.Field('project', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('role', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('category', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('summary', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('content', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('tags', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('confidence', new this._arrowModule.Float32(), true),
        new this._arrowModule.Field('source', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('git_sha', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('embedding', new this._arrowModule.FixedSizeList(dim, new this._arrowModule.Field('item', new this._arrowModule.Float32()))),
        new this._arrowModule.Field('content_hash', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('model', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('created_at', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('updated_at', new this._arrowModule.Utf8(), true),
      ]);
      return await db.createTable(tableName, [], { schema });
    }
  }

  async _getDocumentsTable() {
    const db = await this._getDb();
    const tableName = 'documents_v1';
    const dim = await this.getEngineDimensions();

    try {
      return await db.openTable(tableName);
    } catch {
      const schema = new this._arrowModule.Schema([
        new this._arrowModule.Field('id', new this._arrowModule.Utf8()),
        new this._arrowModule.Field('project', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('kind', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('title', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('summary', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('body', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('source_path', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('tags', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('content_hash', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('embedding', new this._arrowModule.FixedSizeList(dim, new this._arrowModule.Field('item', new this._arrowModule.Float32()))),
        new this._arrowModule.Field('model', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('created_at', new this._arrowModule.Utf8(), true),
        new this._arrowModule.Field('updated_at', new this._arrowModule.Utf8(), true),
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

  async isPgvectorEnabled() {
    return this.isHealthy();
  }

  async storeObservation(record) {
    const table = await this._getObservationsTable();
    const now = new Date().toISOString();
    
    const data = {
      id: record.id,
      project: record.project || '',
      role: record.role || 'unknown',
      category: record.category || 'insight',
      summary: record.summary || '',
      content: record.content || '',
      tags: JSON.stringify(record.tags || []),
      confidence: Number(record.confidence || 0.8),
      source: typeof record.source === 'object' ? JSON.stringify(record.source) : (record.source || ''),
      git_sha: record.gitSha || '',
      embedding: Array.from(record.embedding),
      content_hash: record.contentHash || '',
      model: record.model || '',
      created_at: record.createdAt || now,
      updated_at: now
    };

    await table.mergeInsert('id')
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute([data]);

    return { mode: 'lancedb', id: record.id };
  }

  async getObservationFingerprints(ids = []) {
    const table = await this._getObservationsTable();
    if (!Array.isArray(ids) || ids.length === 0) return new Map();
    
    const results = await table.query()
      .where(`id IN (${ids.map(id => `'${id}'`).join(',')})`)
      .select(['id', 'content_hash', 'model'])
      .toArray();

    return new Map(results.map((r) => [r.id, { contentHash: r.content_hash, model: r.model }]));
  }

  async searchObservations({ project, queryEmbedding, limit = 10, minSimilarity = 0.01, role, category }) {
    const table = await this._getObservationsTable();
    
    const query = table.query()
      .nearestTo(Array.from(queryEmbedding))
      .distanceType('cosine');

    const rawResults = await query.limit(100).toArray();
    
    return rawResults.map(r => {
      const distance = r._distance !== undefined ? r._distance : 0;
      let tags = [];
      try {
        tags = (typeof r.tags === 'string' && r.tags.startsWith('[')) ? JSON.parse(r.tags) : (Array.isArray(r.tags) ? r.tags : []);
      } catch {}
      
      return {
        ...r,
        similarity: 1 - distance,
        tags
      };
    })
    .filter(r => {
      // Use fuzzy similarity and robust project matching
      if (r.similarity < minSimilarity) return false;
      if (project && r.project !== project) return false;
      if (role && r.role && r.role !== role) return false;
      if (category && r.category && r.category !== category) return false;
      return true;
    })
    .slice(0, limit);
  }

  async storeDocument(record) {
    const table = await this._getDocumentsTable();
    const now = new Date().toISOString();
    
    const data = {
      id: record.id,
      project: record.project || '',
      kind: record.kind || '',
      title: record.title || '',
      summary: record.summary || '',
      body: record.body || '',
      source_path: record.sourcePath || '',
      tags: JSON.stringify(record.tags || []),
      content_hash: record.contentHash || '',
      embedding: Array.from(record.embedding),
      model: record.model || '',
      created_at: record.createdAt || now,
      updated_at: now
    };

    await table.mergeInsert('id')
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute([data]);

    return { mode: 'lancedb', id: record.id };
  }

  async searchDocuments({ project, queryEmbedding, limit = 10, minSimilarity = 0.01 }) {
    const table = await this._getDocumentsTable();
    
    const query = table.query()
      .nearestTo(Array.from(queryEmbedding))
      .distanceType('cosine');

    const rawResults = await query.limit(100).toArray();

    return rawResults.map(r => {
      const distance = r._distance !== undefined ? r._distance : 0;
      let tags = [];
      try {
        tags = (typeof r.tags === 'string' && r.tags.startsWith('[')) ? JSON.parse(r.tags) : (Array.isArray(r.tags) ? r.tags : []);
      } catch {}

      return {
        ...r,
        similarity: 1 - distance,
        tags
      };
    })
    .filter(r => {
      if (r.similarity < minSimilarity) return false;
      if (project && r.project !== project) return false;
      return true;
    })
    .slice(0, limit);
  }

  async close() {
    this._db = null;
  }
}
