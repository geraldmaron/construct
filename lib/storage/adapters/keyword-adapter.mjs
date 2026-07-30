/**
 * lib/storage/adapters/keyword-adapter.mjs — dependency-free keyword/BM25
 * retrieval adapter (the no-vector fallback, disposition-matrix.md D6s).
 *
 * Implements the same RetrievalAdapter surface as lib/storage/vector-client.mjs
 * (contract documented in lib/storage/retrieval-adapter.mjs) without an
 * embedding model or a vector database: observations/documents are persisted
 * as plain JSON arrays under the project's machine-scoped state root
 * and ranked at query time with the existing BM25 utilities
 * (lib/storage/embeddings.mjs's rankByBm25) — the same scorer
 * lib/knowledge/rag.mjs and lib/knowledge/search.mjs already use for their
 * zero-dependency retrieval path. Selected automatically
 * (lib/storage/retrieval-adapter.mjs) whenever the LanceDB adapter is absent
 * or unhealthy, or explicitly via CONSTRUCT_RETRIEVAL_ADAPTER=keyword.
 *
 * Storage layout mirrors vector-client.mjs's tables:
 *   <stateRoot>/keyword-index/observations.json — array of stored observation rows
 *   <stateRoot>/keyword-index/documents.json    — array of stored document rows
 * Both are this adapter's OWN derived index — never the source of truth. The
 * durable source of truth for observations is lib/observation-store.mjs's
 * per-record JSON files (.construct/observations/<id>.json); the domain model
 * (D4s) is unaffected by which retrieval adapter is active.
 * scripts/reindex-retrieval-adapter.mjs rebuilds this index from that source,
 * so switching adapters never loses data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveStateDir } from '../../state-root.mjs';
import { rankByBm25 } from '../embeddings.mjs';

function keywordIndexDir(rootDir, env) {
  if (env?.CONSTRUCT_KEYWORD_INDEX_PATH) return env.CONSTRUCT_KEYWORD_INDEX_PATH;
  return resolveStateDir(rootDir || process.cwd(), 'keyword-index', { ensureDir: false });
}

function readRows(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRows(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows, null, 2) + '\n');
}

function parseTags(raw) {
  try {
    if (typeof raw === 'string') return raw.startsWith('[') ? JSON.parse(raw) : [];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

// Ranked BM25 scores are unbounded; normalize against the top hit in THIS
// result set so minSimilarity behaves like the LanceDB adapter's cosine
// similarity floor (a [0,1]-ish band) instead of a raw, corpus-dependent score.

function normalizeRanked(ranked) {
  const maxScore = ranked[0]?.score || 1;
  return ranked.map((r) => ({ ...r, tags: parseTags(r.tags), similarity: r.score / maxScore }));
}

export class KeywordRetrievalAdapter {
  constructor({ env, rootDir } = {}) {
    this.env = env || process.env;
    this.rootDir = rootDir || process.cwd();
    this.mode = 'keyword';
  }

  get indexDir() {
    return keywordIndexDir(this.rootDir, this.env);
  }

  _observationsFile() {
    return path.join(this.indexDir, 'observations.json');
  }

  _documentsFile() {
    return path.join(this.indexDir, 'documents.json');
  }

  async isHealthy() {
    return true;
  }

  async isPgvectorEnabled() {
    return false;
  }

  async hasObservationsTable() {
    return fs.existsSync(this._observationsFile());
  }

  async storeObservation(record) {
    const file = this._observationsFile();
    const rows = readRows(file);
    const now = new Date().toISOString();

    const row = {
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
      content_hash: record.contentHash || '',
      model: record.model || '',
      created_at: record.createdAt || now,
      updated_at: now,
    };

    const idx = rows.findIndex((r) => r.id === row.id);
    if (idx === -1) rows.push(row);
    else rows[idx] = row;
    writeRows(file, rows);

    return { mode: 'keyword', id: record.id };
  }

  async getObservationFingerprints(ids = []) {
    if (!Array.isArray(ids) || ids.length === 0) return new Map();
    const byId = new Map(readRows(this._observationsFile()).map((r) => [r.id, r]));
    const out = new Map();
    for (const id of ids) {
      const row = byId.get(id);
      if (row) out.set(id, { contentHash: row.content_hash, model: row.model });
    }
    return out;
  }

  async pruneObservations({ maxAgeDays, maxRows } = {}) {
    const file = this._observationsFile();
    const rows = readRows(file);
    if (rows.length === 0) return { evictedCount: 0, remainingCount: 0, oldestRetainedAt: null };

    let kept = rows;
    let evictedCount = 0;

    if (typeof maxAgeDays === 'number' && maxAgeDays > 0) {
      const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
      const before = kept.length;
      kept = kept.filter((r) => new Date(r.created_at).getTime() >= cutoff);
      evictedCount += before - kept.length;
    }

    if (typeof maxRows === 'number' && maxRows > 0 && kept.length > maxRows) {
      const sorted = [...kept].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const before = sorted.length;
      kept = sorted.slice(sorted.length - maxRows);
      evictedCount += before - kept.length;
    }

    writeRows(file, kept);
    const timestamps = kept.map((r) => r.created_at).filter(Boolean).sort();
    return {
      evictedCount,
      remainingCount: kept.length,
      oldestRetainedAt: timestamps[0] ?? null,
    };
  }

  async searchObservations({ project, query, limit = 10, minSimilarity = 0.01, role, category } = {}) {
    if (!query) return [];

    const candidates = readRows(this._observationsFile())
      .filter((r) => !project || r.project === project)
      .filter((r) => !role || r.role === role)
      .filter((r) => !category || r.category === category);

    const ranked = rankByBm25(candidates, query, { limit: candidates.length });
    return normalizeRanked(ranked)
      .filter((r) => r.similarity >= minSimilarity)
      .slice(0, limit);
  }

  async storeDocument(record) {
    const file = this._documentsFile();
    const rows = readRows(file);
    const now = new Date().toISOString();

    const row = {
      id: record.id,
      project: record.project || '',
      kind: record.kind || '',
      title: record.title || '',
      summary: record.summary || '',
      body: record.body || '',
      source_path: record.sourcePath || '',
      tags: JSON.stringify(record.tags || []),
      content_hash: record.contentHash || '',
      model: record.model || '',
      created_at: record.createdAt || now,
      updated_at: now,
    };

    const idx = rows.findIndex((r) => r.id === row.id);
    if (idx === -1) rows.push(row);
    else rows[idx] = row;
    writeRows(file, rows);

    return { mode: 'keyword', id: record.id };
  }

  async searchDocuments({ project, query, limit = 10, minSimilarity = 0.01 } = {}) {
    if (!query) return [];

    const candidates = readRows(this._documentsFile()).filter((r) => !project || r.project === project);
    const ranked = rankByBm25(candidates, query, { limit: candidates.length });
    return normalizeRanked(ranked)
      .filter((r) => r.similarity >= minSimilarity)
      .slice(0, limit);
  }

  async sizeBytes() {
    let total = 0;
    for (const file of [this._observationsFile(), this._documentsFile()]) {
      if (fs.existsSync(file)) total += fs.statSync(file).size;
    }
    return total;
  }

  async exists() {
    return fs.existsSync(this._observationsFile()) || fs.existsSync(this._documentsFile());
  }

  async reset() {
    const dir = this.indexDir;
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }

  async close() {}
}
