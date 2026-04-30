/**
 * lib/storage/vector-client.mjs — Unified vector storage client for pgvector.
 *
 * Hides whether we're using local Postgres, managed Postgres, or (future) external vector DB.
 * All callers use: store(id, embedding, metadata) and search(queryEmbedding, filters).
 *
 * Works with any Postgres that has the pgvector extension installed.
 * Connection string (DATABASE_URL) determines the target.
 *
 * NOTE: `postgres` package is imported lazily to avoid ERR_MODULE_NOT_FOUND
 * when this module is loaded in environments where `postgres` is not installed.
 */

const DEFAULT_POOL = { max: 10, idle_timeout: 20, connect_timeout: 10 };

function floatArrayToPgVector(arr) {
  if (!arr) return null;
  const values = arr instanceof Float32Array ? Array.from(arr) : arr;
  return `[${values.join(',')}]`;
}

export class VectorClient {
  constructor({ databaseUrl } = {}) {
    this.url = databaseUrl || process.env.DATABASE_URL || null;
    this._sql = null;
    this._pgModule = null;
  }

  /**
   * Lazily load the `postgres` module and create the connection.
   */
  async _getSql() {
    if (!this.url) return null;
    if (this._sql) return this._sql;

    if (!this._pgModule) {
      try {
        const m = await import('postgres');
        this._pgModule = m.default || m;
      } catch (err) {
        // Re-throw with a clearer message so callers understand why
        throw new Error(
          `Failed to load 'postgres' module: ${err.message}. ` +
          `Ensure 'postgres' is installed (npm install postgres).`
        );
      }
    }

    this._sql = this._pgModule(this.url, DEFAULT_POOL);
    return this._sql;
  }

  /**
   * Check if the SQL backend is available and healthy.
   */
  async isHealthy() {
    const sql = await this._getSql();
    if (!sql) return false;
    try {
      const result = await sql`SELECT 1 AS health`;
      return result?.[0]?.health === 1;
    } catch {
      return false;
    }
  }

  /**
   * Check if pgvector extension is enabled.
   */
  async isPgvectorEnabled() {
    const sql = await this._getSql();
    if (!sql) return false;
    try {
      const result = await sql`
        SELECT EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = 'vector'
        ) AS enabled
      `;
      return result?.[0]?.enabled === true;
    } catch {
      return false;
    }
  }

  /**
   * Store an observation with its embedding.
   */
  async storeObservation({ id, project, role, category, summary, content, tags, confidence, source, embedding, gitSha }) {
    const sql = await this._getSql();
    if (!sql) return { mode: 'file', reason: 'no_sql' };

    const embeddingVec = floatArrayToPgVector(embedding);
    await sql`
      INSERT INTO construct_observations (id, project, role, category, summary, content, tags, confidence, source, git_sha, embedding)
      VALUES (${id}, ${project}, ${role}, ${category}, ${summary}, ${content}, ${JSON.stringify(tags || [])}, ${confidence || 0.8}, ${source || null}, ${gitSha || null}, ${embeddingVec})
      ON CONFLICT (id) DO UPDATE SET
        summary = EXCLUDED.summary,
        content = EXCLUDED.content,
        tags = EXCLUDED.tags,
        confidence = EXCLUDED.confidence,
        source = EXCLUDED.source,
        git_sha = EXCLUDED.git_sha,
        embedding = EXCLUDED.embedding,
        updated_at = now()
    `;
    return { mode: 'sql', id };
  }

  /**
   * Search observations by vector similarity.
   */
  async searchObservations({ project, queryEmbedding, limit = 10, minSimilarity = 0.3, role, category }) {
    const sql = await this._getSql();
    if (!sql) return [];

    const queryVec = floatArrayToPgVector(queryEmbedding);
    const conditions = [sql`project = ${project}`];
    if (role) conditions.push(sql`role = ${role}`);
    if (category) conditions.push(sql`category = ${category}`);
    conditions.push(sql`1 - (embedding <=> ${queryVec}) > ${minSimilarity}`);

    const results = await sql`
      SELECT 
        id, role, category, summary, content, tags, confidence, source, git_sha, created_at,
        1 - (embedding <=> ${queryVec}) AS similarity
      FROM construct_observations
      WHERE ${sql.join(conditions, ' AND ')}
      ORDER BY embedding <=> ${queryVec}
      LIMIT ${limit}
    `;
    return results;
  }

  /**
   * Store a document with its embedding.
   */
  async storeDocument({ id, project, kind, title, summary, body, sourcePath, tags, contentHash, embedding }) {
    const sql = await this._getSql();
    if (!sql) return { mode: 'file', reason: 'no_sql' };

    const embeddingVec = floatArrayToPgVector(embedding);
    await sql`
      INSERT INTO construct_documents (id, project, kind, title, summary, body, source_path, tags, content_hash)
      VALUES (${id}, ${project}, ${kind}, ${title}, ${summary || ''}, ${body}, ${sourcePath || ''}, ${JSON.stringify(tags || [])}, ${contentHash || ''})
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        body = EXCLUDED.body,
        source_path = EXCLUDED.source_path,
        tags = EXCLUDED.tags,
        content_hash = EXCLUDED.content_hash,
        updated_at = now()
    `;

    await sql`
      INSERT INTO construct_embeddings (document_id, model, embedding, content_hash)
      VALUES (${id}, 'hashing-bow-v1', ${embeddingVec}, ${contentHash || ''})
      ON CONFLICT (document_id) DO UPDATE SET
        model = EXCLUDED.model,
        embedding = EXCLUDED.embedding,
        content_hash = EXCLUDED.content_hash,
        updated_at = now()
    `;
    return { mode: 'sql', id };
  }

  /**
   * Search documents by vector similarity.
   */
  async searchDocuments({ project, queryEmbedding, limit = 10, minSimilarity = 0.3 }) {
    const sql = await this._getSql();
    if (!sql) return [];

    const queryVec = floatArrayToPgVector(queryEmbedding);
    const results = await sql`
      SELECT 
        d.id, d.title, d.summary, d.body, d.source_path, d.tags, d.kind,
        1 - (e.embedding <=> ${queryVec}) AS similarity
      FROM construct_documents d
      JOIN construct_embeddings e ON d.id = e.document_id
      WHERE d.project = ${project}
        AND 1 - (e.embedding <=> ${queryVec}) > ${minSimilarity}
      ORDER BY e.embedding <=> ${queryVec}
      LIMIT ${limit}
    `;
    return results;
  }

  /**
   * Close the connection pool.
   */
  async close() {
    if (this._sql) {
      await this._sql.end();
      this._sql = null;
    }
  }
}
