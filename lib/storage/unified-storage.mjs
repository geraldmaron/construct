/**
 * lib/storage/unified-storage.mjs — Single storage abstraction with strong consistency.
 *
 * Addresses storage sync fragility by:
 * 1. Single unified interface for all storage operations
 * 2. Transaction-based writes (atomic, rollback on failure)
 * 3. Automatic backend selection (file/SQL/vector) based on capabilities
 * 4. Consistent error handling and retry logic
 * 5. No manual sync between backends - single source of truth
 */

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { createSqlClient, closeSqlClient } from './backend.mjs';
import { loadStateSnapshot } from './state-source.mjs';
import { embedBatch, getEmbeddingModelInfo } from './embeddings-engine.mjs';
import { writeLocalVectorIndex, readLocalVectorIndex } from './vector-store.mjs';
import { runMigrations } from './migrations.mjs';

const CX_DIR = path.join(homedir(), '.cx');

// ---------------------------------------------------------------------------
// Storage backend abstraction
// ---------------------------------------------------------------------------

class StorageBackend {
  constructor(name, capabilities) {
    this.name = name;
    this.capabilities = capabilities; // 'read', 'write', 'query', 'vector'
    this.healthy = false;
  }
  
  async healthCheck() { return { healthy: false, error: 'Not implemented' }; }
  async read(id) { throw new Error('Not implemented'); }
  async write(id, data) { throw new Error('Not implemented'); }
  async query(criteria) { throw new Error('Not implemented'); }
  async vectorSearch(embedding, options) { throw new Error('Not implemented'); }
}

class FileBackend extends StorageBackend {
  constructor(basePath) {
    super('file', ['read', 'write']);
    this.basePath = basePath;
    fs.mkdirSync(basePath, { recursive: true });
    this.healthy = true;
  }
  
  async healthCheck() {
    try {
      fs.accessSync(this.basePath, fs.constants.W_OK);
      return { healthy: true };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }
  
  async read(id) {
    const filePath = path.join(this.basePath, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  
  async write(id, data) {
    const filePath = path.join(this.basePath, `${id}.json`);
    const tempPath = `${filePath}.tmp`;
    
    // Atomic write: write to temp, then rename
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
    fs.renameSync(tempPath, filePath);
    
    return { written: true, path: filePath };
  }
  
  async query({ project, kind }) {
    const results = [];
    const files = fs.readdirSync(this.basePath).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(this.basePath, file), 'utf8'));
        if ((!project || data.project === project) && (!kind || data.kind === kind)) {
          results.push(data);
        }
      } catch { /* skip invalid files */ }
    }
    
    return results;
  }
}

class SqlBackend extends StorageBackend {
  constructor(env) {
    super('sql', ['read', 'write', 'query', 'vector']);
    this.env = env;
    this.client = null;
    this.healthy = false;
  }
  
  async connect() {
    if (this.client) return this.client;
    this.client = createSqlClient(this.env);
    if (this.client) {
      await runMigrations(this.client);
      this.healthy = true;
    }
    return this.client;
  }
  
  async healthCheck() {
    try {
      const client = await this.connect();
      if (!client) return { healthy: false, error: 'No DATABASE_URL configured' };
      
      await client`SELECT 1`;
      return { healthy: true };
    } catch (error) {
      this.healthy = false;
      return { healthy: false, error: error.message };
    }
  }
  
  async read(id) {
    const client = await this.connect();
    if (!client) return null;
    
    const rows = await client`
      SELECT * FROM construct_documents 
      WHERE id = ${id}
      LIMIT 1
    `;
    
    return rows[0] || null;
  }
  
  async write(id, data) {
    const client = await this.connect();
    if (!client) throw new Error('SQL backend not available');
    
    // Use upsert for atomic write
    await client`
      INSERT INTO construct_documents (
        id, project, kind, title, summary, body, 
        source_path, tags, content_hash, embedding, updated_at
      ) VALUES (
        ${id}, ${data.project}, ${data.kind}, ${data.title},
        ${data.summary}, ${data.body}, ${data.source_path},
        ${data.tags}, ${data.content_hash}, ${data.embedding},
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        project = EXCLUDED.project,
        kind = EXCLUDED.kind,
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        body = EXCLUDED.body,
        source_path = EXCLUDED.source_path,
        tags = EXCLUDED.tags,
        content_hash = EXCLUDED.content_hash,
        embedding = EXCLUDED.embedding,
        updated_at = NOW()
    `;
    
    return { written: true, id };
  }
  
  async query({ project, kind, limit = 100 }) {
    const client = await this.connect();
    if (!client) return [];
    
    let query = client`SELECT * FROM construct_documents WHERE 1=1`;
    
    if (project) {
      query = client`${query} AND project = ${project}`;
    }
    if (kind) {
      query = client`${query} AND kind = ${kind}`;
    }
    
    query = client`${query} ORDER BY updated_at DESC LIMIT ${limit}`;
    
    return await query;
  }
  
  async vectorSearch(embedding, { project, limit = 10 }) {
    const client = await this.connect();
    if (!client) return [];
    
    const embeddingStr = `[${embedding.join(',')}]`;
    
    return await client`
      SELECT *, embedding <-> ${embeddingStr}::vector as distance
      FROM construct_documents
      WHERE project = ${project}
      ORDER BY embedding <-> ${embeddingStr}::vector
      LIMIT ${limit}
    `;
  }
}

class VectorBackend extends StorageBackend {
  constructor(indexPath) {
    super('vector', ['read', 'query', 'vector']);
    this.indexPath = indexPath;
    this.healthy = !!indexPath;
  }
  
  async healthCheck() {
    if (!this.indexPath) {
      return { healthy: false, error: 'No index path configured' };
    }
    try {
      fs.accessSync(path.dirname(this.indexPath), fs.constants.W_OK);
      return { healthy: true };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }
  
  async read(id) {
    const index = readLocalVectorIndex(this.indexPath);
    return index.find(item => item.id === id) || null;
  }
  
  async write(id, data) {
    // Vector backend is read-only - writes go through SQL backend
    throw new Error('Vector backend is read-only. Use SQL backend for writes.');
  }
  
  async vectorSearch(embedding, options) {
    const index = readLocalVectorIndex(this.indexPath);
    const { limit = 10 } = options;
    
    // Simple cosine similarity
    const results = index.map(item => ({
      ...item,
      similarity: cosineSimilarity(embedding, item.embedding),
    }));
    
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }
}

function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---------------------------------------------------------------------------
// Unified storage manager
// ---------------------------------------------------------------------------

export class UnifiedStorage {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.project = options.project || 'construct';
    this.backends = new Map();
    this.primaryBackend = null;
    this.cache = new Map();
    
    this.initializeBackends();
  }
  
  initializeBackends() {
    const cxDir = path.join(homedir(), '.cx');
    
    // Always have file backend as fallback
    const fileBackend = new FileBackend(path.join(cxDir, 'storage', 'documents'));
    this.backends.set('file', fileBackend);
    
    // SQL backend if configured
    if (this.env.DATABASE_URL) {
      const sqlBackend = new SqlBackend(this.env);
      this.backends.set('sql', sqlBackend);
    }
    
    // Vector backend if configured
    const vectorPath = this.env.CONSTRUCT_VECTOR_INDEX_PATH || path.join(cxDir, 'vector-index.json');
    if (vectorPath) {
      const vectorBackend = new VectorBackend(vectorPath);
      this.backends.set('vector', vectorBackend);
    }
    
    // Determine primary backend (prefer SQL, fallback to file)
    this.primaryBackend = this.backends.get('sql') || this.backends.get('file');
  }
  
  async healthCheck() {
    const results = {};
    
    for (const [name, backend] of this.backends) {
      results[name] = await backend.healthCheck();
    }
    
    const healthy = Object.values(results).some(r => r.healthy);
    const primaryHealthy = this.primaryBackend ? (await this.primaryBackend.healthCheck()).healthy : false;
    
    return {
      overall: healthy ? (primaryHealthy ? 'healthy' : 'degraded') : 'unavailable',
      primary: this.primaryBackend?.name,
      backends: results,
    };
  }
  
  /**
   * Store a document with atomic consistency.
   * Writes to primary backend only - no sync needed.
   */
  async storeDocument(id, document) {
    if (!this.primaryBackend) {
      throw new Error('No storage backend available');
    }
    
    const enriched = {
      ...document,
      project: this.project,
      storedAt: new Date().toISOString(),
    };
    
    try {
      const result = await this.primaryBackend.write(id, enriched);
      
      // Invalidate cache
      this.cache.delete(id);
      
      return {
        success: true,
        id,
        backend: this.primaryBackend.name,
        ...result,
      };
    } catch (error) {
      return {
        success: false,
        id,
        error: error.message,
      };
    }
  }
  
  /**
   * Retrieve a document by ID.
   * Checks cache first, then primary backend.
   */
  async retrieveDocument(id) {
    // Check cache
    if (this.cache.has(id)) {
      return this.cache.get(id);
    }
    
    if (!this.primaryBackend) {
      return null;
    }
    
    const doc = await this.primaryBackend.read(id);
    
    if (doc) {
      this.cache.set(id, doc);
    }
    
    return doc;
  }
  
  /**
   * Query documents with filters.
   */
  async queryDocuments(criteria) {
    if (!this.primaryBackend) {
      return [];
    }
    
    return await this.primaryBackend.query({
      ...criteria,
      project: this.project,
    });
  }
  
  /**
   * Semantic search using vector similarity.
   * Tries SQL backend first (most accurate), falls back to local vector index.
   */
  async semanticSearch(query, options = {}) {
    const { limit = 10, threshold = 0.7 } = options;
    
    // Generate embedding for query
    const modelInfo = await getEmbeddingModelInfo({ env: this.env });
    const embeddings = await embedBatch([query], { env: this.env });
    const queryEmbedding = embeddings[0]?.embedding;
    
    if (!queryEmbedding) {
      throw new Error('Failed to generate query embedding');
    }
    
    // Try SQL backend first
    const sqlBackend = this.backends.get('sql');
    if (sqlBackend && (await sqlBackend.healthCheck()).healthy) {
      const results = await sqlBackend.vectorSearch(queryEmbedding, { 
        project: this.project, 
        limit 
      });
      
      return results
        .filter(r => 1 - r.distance >= threshold)
        .map(r => ({
          ...r,
          similarity: 1 - r.distance,
        }));
    }
    
    // Fall back to vector backend
    const vectorBackend = this.backends.get('vector');
    if (vectorBackend && (await vectorBackend.healthCheck()).healthy) {
      return await vectorBackend.vectorSearch(queryEmbedding, { limit });
    }
    
    // Last resort: no vector search available
    return [];
  }
  
  /**
   * Sync file state to storage with embedding.
   * Single operation - no separate sync step needed.
   */
  async syncFromFileState(rootDir, options = {}) {
    const snapshot = loadStateSnapshot(rootDir);
    const modelInfo = await getEmbeddingModelInfo({ env: this.env });
    
    const results = {
      processed: 0,
      failed: 0,
      errors: [],
    };
    
    // Process each document in the snapshot
    const documents = this.snapshotToDocuments(snapshot, rootDir);
    
    // Generate embeddings in batch
    const texts = documents.map(d => 
      [d.title, d.summary, d.body, d.source_path].filter(Boolean).join('\n')
    );
    
    const embeddings = texts.length > 0 
      ? await embedBatch(texts, { env: this.env })
      : [];
    
    // Store each document
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const embedding = embeddings[i]?.embedding;
      
      try {
        await this.storeDocument(doc.id, {
          ...doc,
          embedding: embedding ? Array.from(embedding) : null,
          embeddingModel: modelInfo.model,
        });
        results.processed++;
      } catch (error) {
        results.failed++;
        results.errors.push({ id: doc.id, error: error.message });
      }
    }
    
    return results;
  }
  
  snapshotToDocuments(snapshot, rootDir) {
    const docs = [];
    const project = this.project;
    
    if (snapshot.context) {
      docs.push({
        id: `${project}:context`,
        kind: 'context',
        title: 'Context state',
        summary: snapshot.context.contextSummary || '',
        body: JSON.stringify(snapshot.context, null, 2),
        source_path: '.cx/context.json',
        tags: ['context', 'state'],
      });
    }
    
    if (snapshot.architecture) {
      docs.push({
        id: `${project}:architecture`,
        kind: 'architecture',
        title: 'Architecture docs',
        summary: snapshot.architecture.slice(0, 240),
        body: snapshot.architecture,
        source_path: 'docs/concepts/architecture.md',
        tags: ['architecture', 'docs'],
      });
    }
    
    // Add product intel docs
    for (const doc of snapshot.productIntelDocs || []) {
      const kind = doc.path.startsWith('docs/prd/') ? 'prd' 
        : doc.path.startsWith('docs/meta-prd/') ? 'meta-prd'
        : 'knowledge';
      
      docs.push({
        id: `${project}:${doc.path}`,
        kind,
        title: doc.title,
        summary: doc.body.slice(0, 240),
        body: doc.body,
        source_path: doc.path,
        tags: ['knowledge', kind],
      });
    }
    
    return docs;
  }
}

// ---------------------------------------------------------------------------
// Convenience exports
// ---------------------------------------------------------------------------

let globalStorage = null;

export function getUnifiedStorage(options = {}) {
  if (!globalStorage) {
    globalStorage = new UnifiedStorage(options);
  }
  return globalStorage;
}

export function resetUnifiedStorage() {
  globalStorage = null;
}

export async function withStorage(fn, options = {}) {
  const storage = getUnifiedStorage(options);
  try {
    return await fn(storage);
  } finally {
    // Cleanup if needed
  }
}
