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

// LanceDB uses optimistic concurrency: two writes racing the same table fail
// with "Incompatible transaction ... Overwrite at version N" and two creates
// race "Table already exists". Call sites build a fresh VectorClient per write
// (inbox ingest fans out across files), so writes are serialized per database
// directory at module scope — keyed by path, not by instance — and the queue
// key is dropped once its chain drains.

const writeQueues = new Map();

function serializeWrite(dbPath, task) {
  const prev = writeQueues.get(dbPath) || Promise.resolve();
  const run = prev.then(task, task);
  const chain = run.then(() => {}, () => {});
  writeQueues.set(dbPath, chain);
  chain.then(() => {
    if (writeQueues.get(dbPath) === chain) writeQueues.delete(dbPath);
  });
  return run;
}

// Serialization covers this process; a retry absorbs the residual conflict from
// a concurrent writer in another process (separate test files) or a create race.

async function withWriteRetry(task, { attempts = 6, baseMs = 25 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await task();
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      const retriable = /Incompatible transaction|already exists|Commit conflict|conflict_resolver|failed to persist|No such file or directory|LanceError\(IO\)/i.test(msg);
      if (!retriable || attempt === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, baseMs * (attempt + 1)));
    }
  }
  throw lastErr;
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

  _observationsSchema(dim) {
    const A = this._arrowModule;
    return new A.Schema([
      new A.Field('id', new A.Utf8()),
      new A.Field('project', new A.Utf8(), true),
      new A.Field('role', new A.Utf8(), true),
      new A.Field('category', new A.Utf8(), true),
      new A.Field('summary', new A.Utf8(), true),
      new A.Field('content', new A.Utf8(), true),
      new A.Field('tags', new A.Utf8(), true),
      new A.Field('confidence', new A.Float32(), true),
      new A.Field('source', new A.Utf8(), true),
      new A.Field('git_sha', new A.Utf8(), true),
      new A.Field('embedding', new A.FixedSizeList(dim, new A.Field('item', new A.Float32()))),
      new A.Field('content_hash', new A.Utf8(), true),
      new A.Field('model', new A.Utf8(), true),
      new A.Field('created_at', new A.Utf8(), true),
      new A.Field('updated_at', new A.Utf8(), true),
    ]);
  }

  _documentsSchema(dim) {
    const A = this._arrowModule;
    return new A.Schema([
      new A.Field('id', new A.Utf8()),
      new A.Field('project', new A.Utf8(), true),
      new A.Field('kind', new A.Utf8(), true),
      new A.Field('title', new A.Utf8(), true),
      new A.Field('summary', new A.Utf8(), true),
      new A.Field('body', new A.Utf8(), true),
      new A.Field('source_path', new A.Utf8(), true),
      new A.Field('tags', new A.Utf8(), true),
      new A.Field('content_hash', new A.Utf8(), true),
      new A.Field('embedding', new A.FixedSizeList(dim, new A.Field('item', new A.Float32()))),
      new A.Field('model', new A.Utf8(), true),
      new A.Field('created_at', new A.Utf8(), true),
      new A.Field('updated_at', new A.Utf8(), true),
    ]);
  }

  // Open an existing table, or null if it does not exist. Reads never create a
  // table: querying an empty table created with `createTable(name, [], schema)`
  // fails on the Linux LanceDB build with "No vector column found to match the
  // query vector dimension", because the embedding column is only resolved once
  // the table holds data.
  async _openTable(name) {
    await this._initModules();
    const db = await this._getDb();
    try {
      return await db.openTable(name);
    } catch {
      return null;
    }
  }

  // Upsert by id. The first write creates the table WITH its rows so the vector
  // column is established from real data; later writes merge into the existing
  // table. A create that loses the race falls back to a merge.
  async _upsertRows(name, schema, rows) {
    const db = await this._getDb();
    const existing = await this._openTable(name);
    if (existing) {
      await existing.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll().execute(rows);
      return;
    }
    try {
      await db.createTable(name, rows, { schema });
    } catch (err) {
      if (!/already exists/i.test(String(err?.message))) throw err;
      const table = await db.openTable(name);
      await table.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll().execute(rows);
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
    return serializeWrite(getDbPath(this.env), () => withWriteRetry(() => this._storeObservation(record)));
  }

  async _storeObservation(record) {
    await this._initModules();
    const dim = await this.getEngineDimensions();
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

    await this._upsertRows('observations_v1', this._observationsSchema(dim), [data]);

    return { mode: 'lancedb', id: record.id };
  }

  async getObservationFingerprints(ids = []) {
    if (!Array.isArray(ids) || ids.length === 0) return new Map();
    const table = await this._openTable('observations_v1');
    if (!table) return new Map();

    const results = await table.query()
      .where(`id IN (${ids.map(id => `'${id}'`).join(',')})`)
      .select(['id', 'content_hash', 'model'])
      .toArray();

    return new Map(results.map((r) => [r.id, { contentHash: r.content_hash, model: r.model }]));
  }

  async searchObservations({ project, queryEmbedding, limit = 10, minSimilarity = 0.01, role, category }) {
    const table = await this._openTable('observations_v1');
    if (!table) return [];

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
    return serializeWrite(getDbPath(this.env), () => withWriteRetry(() => this._storeDocument(record)));
  }

  async _storeDocument(record) {
    await this._initModules();
    const dim = await this.getEngineDimensions();
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

    await this._upsertRows('documents_v1', this._documentsSchema(dim), [data]);

    return { mode: 'lancedb', id: record.id };
  }

  async searchDocuments({ project, queryEmbedding, limit = 10, minSimilarity = 0.01 }) {
    const table = await this._openTable('documents_v1');
    if (!table) return [];

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
