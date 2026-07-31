/**
 * lib/storage/vector-client.mjs — LanceDB retrieval-adapter implementation.
 *
 * LanceDB adapter behind the retrieval-adapter contract
 * (lib/storage/retrieval-adapter.mjs): one adapter among possible others, not
 * a hard core dependency (disposition-matrix.md D6s). `@lancedb/lancedb` and
 * `apache-arrow` are optionalDependencies — _initModules() loads them lazily
 * and throws a precise error if they are absent, which
 * lib/storage/retrieval-adapter.mjs's 'auto' selection catches to fall back
 * to the dependency-free keyword/BM25 adapter
 * (lib/storage/adapters/keyword-adapter.mjs). Most callers should go through
 * createRetrievalAdapter() rather than constructing VectorClient directly, so
 * they work identically whether or not LanceDB is installed.
 *
 * Unset CONSTRUCT_LANCEDB_PATH falls back to the calling project's
 * machine-scoped state root (`<stateRoot>/lancedb`, keyed off cwd).
 * A managed install sets CONSTRUCT_LANCEDB_PATH to a single machine-wide
 * index (lib/setup.mjs's defaultVectorIndexPath), which always takes
 * precedence; the fallback path only applies to unmanaged/solo runs and tests.
 *
 * The index itself is lazy: _getDb() only connects/creates on the first
 * actual store or search call, never at construction. pruneObservations()
 * (lib/storage/admin.mjs's purgeExpiredData) is the TTL/size eviction path
 * for the machine-scoped store and never creates observations_v1 as a side
 * effect of checking or pruning it.
 */

import fs from 'fs';
import { getEmbeddingModelInfo } from './embeddings-engine.mjs';
import { resolveStateDir } from '../state-root.mjs';

const FALLBACK_DIMENSIONS = 384;

function getDbPath(env = process.env) {
  if (env.CONSTRUCT_LANCEDB_PATH) return env.CONSTRUCT_LANCEDB_PATH;
  // ensureDir:false — this path is computed on every call (including ones
  // that never reach a real connect, e.g. lancedb module load failure), so
  // directory creation stays owned by _getDb() right before it connects.
  return resolveStateDir(process.cwd(), 'lancedb', { ensureDir: false });
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
    this.mode = 'lancedb';
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
      try {
        return await db.createTable(tableName, [], { schema });
      } catch (err) {
        if (/already exists/i.test(String(err?.message))) return await db.openTable(tableName);
        throw err;
      }
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
      try {
        return await db.createTable(tableName, [], { schema });
      } catch (err) {
        if (/already exists/i.test(String(err?.message))) return await db.openTable(tableName);
        throw err;
      }
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

  // Existence check that never creates the table as a side effect — a purge
  // or doctor report must not conjure observations_v1 just to find it empty;
  // _getObservationsTable() would create it on a missing-table catch.

  async hasObservationsTable() {
    const db = await this._getDb();
    const names = await db.tableNames();
    return names.includes('observations_v1');
  }

  /**
   * Evict rows from observations_v1 older than `maxAgeDays` and/or beyond
   * the `maxRows` most-recent cap. Either bound is optional; passing neither
   * is a no-op. Returns eviction stats so callers (doctor, `construct prune`,
   * the post-sync retention hook) can report on the machine-scoped store
   * without re-deriving it themselves.
   */
  async pruneObservations({ maxAgeDays, maxRows } = {}) {
    if (!(await this.hasObservationsTable())) {
      return { evictedCount: 0, remainingCount: 0, oldestRetainedAt: null };
    }
    const table = await this._getObservationsTable();
    let evictedCount = 0;

    if (typeof maxAgeDays === 'number' && maxAgeDays > 0) {
      const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
      const before = await table.countRows();
      await table.delete(`created_at < '${cutoff}'`);
      evictedCount += Math.max(0, before - await table.countRows());
    }

    if (typeof maxRows === 'number' && maxRows > 0) {
      const total = await table.countRows();
      if (total > maxRows) {
        const rows = await table.query().select(['created_at']).toArray();
        const sortedTimestamps = rows.map((r) => r.created_at).sort();
        const cutoff = sortedTimestamps[total - maxRows];
        const before = await table.countRows();
        await table.delete(`created_at < '${cutoff}'`);
        evictedCount += Math.max(0, before - await table.countRows());
      }
    }

    const remaining = await table.query().select(['created_at']).toArray();
    const remainingTimestamps = remaining.map((r) => r.created_at).filter(Boolean).sort();
    return {
      evictedCount,
      remainingCount: remaining.length,
      oldestRetainedAt: remainingTimestamps[0] ?? null,
    };
  }

  async storeObservation(record) {
    return serializeWrite(getDbPath(this.env), () => withWriteRetry(() => this._storeObservation(record)));
  }

  async _storeObservation(record) {
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
    if (await table.countRows() === 0) return [];

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
    if (await table.countRows() === 0) return [];

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
