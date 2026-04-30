/**
 * lib/observation-store.mjs — Role-scoped observation store with vector indexing.
 *
 * Stores distilled insights that specialists learn during work:
 *   - patterns, anti-patterns, dependency relationships, decisions, insights
 *   - each scoped to a role (cx-engineer, cx-architect, etc.)
 *   - vector-indexed for semantic search via hashing-bow-v1
 *
 * Storage layout:
 *   .cx/observations/index.json      — lightweight listing for fast filtering
 *   .cx/observations/<id>.json       — full observation record
 *   .cx/observations/vectors.json    — local vector index for semantic search
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { embedText, cosineSimilarity, rankByBm25 } from './storage/embeddings.mjs';
import { embedText as embedTextEngine } from './storage/embeddings-engine.mjs';
import { VectorClient } from './storage/vector-client.mjs';

const OBS_DIR = '.cx/observations';
const INDEX_FILE = 'index.json';
const VECTORS_FILE = 'vectors.json';
const MAX_INDEX = 1000;
const MAX_SUMMARY = 500;
const MAX_CONTENT = 2000;
const MAX_TAGS = 10;

const VALID_CATEGORIES = new Set([
  'pattern', 'anti-pattern', 'dependency', 'decision', 'insight', 'session-summary',
]);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function obsDir(rootDir) {
  return path.join(rootDir, OBS_DIR);
}

function indexPath(rootDir) {
  return path.join(obsDir(rootDir), INDEX_FILE);
}

function vectorsPath(rootDir) {
  return path.join(obsDir(rootDir), VECTORS_FILE);
}

function generateId() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString('hex');
  return `obs-${ts}-${rand}`;
}

function clamp(str, max) {
  if (!str || str.length <= max) return str || null;
  return str.slice(0, max - 1) + '\u2026';
}

function readIndex(rootDir) {
  const p = indexPath(rootDir);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

function writeIndex(rootDir, entries) {
  ensureDir(obsDir(rootDir));
  const trimmed = entries.slice(0, MAX_INDEX);
  fs.writeFileSync(indexPath(rootDir), JSON.stringify(trimmed, null, 2) + '\n');
}

function readVectors(rootDir) {
  const p = vectorsPath(rootDir);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

function writeVectors(rootDir, records) {
  ensureDir(obsDir(rootDir));
  fs.writeFileSync(vectorsPath(rootDir), JSON.stringify(records, null, 2) + '\n');
}

/**
 * Add a new observation and vectorize it for semantic search.
 * Uses SQL + neural embeddings when available, falls back to local JSON + hashing.
 */
export async function addObservation(rootDir, {
  role = 'unknown',
  category = 'insight',
  summary = '',
  content = '',
  tags = [],
  project = null,
  confidence = 0.8,
  source = null,
  gitSha = null,
} = {}) {
  const id = generateId();
  const now = new Date().toISOString();

  const effectiveCategory = VALID_CATEGORIES.has(category) ? category : 'insight';
  const clampedSummary = clamp(String(summary), MAX_SUMMARY);
  const clampedContent = clamp(String(content), MAX_CONTENT);
  const clampedTags = (Array.isArray(tags) ? tags : []).slice(0, MAX_TAGS).map(String);

  const record = {
    id,
    role: String(role),
    category: effectiveCategory,
    summary: clampedSummary,
    content: clampedContent,
    tags: clampedTags,
    project: project ? String(project) : null,
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0.8)),
    source: source || null,
    gitSha: gitSha ? String(gitSha).slice(0, 40) : null,
    createdAt: now,
    updatedAt: now,
  };

  // Always write to local JSON as backup
  ensureDir(obsDir(rootDir));
  fs.writeFileSync(
    path.join(obsDir(rootDir), `${id}.json`),
    JSON.stringify(record, null, 2) + '\n',
  );

  const index = readIndex(rootDir);
  index.unshift({
    id,
    role: record.role,
    category: record.category,
    summary: record.summary,
    project: record.project,
    createdAt: now,
  });
  writeIndex(rootDir, index);

  // Try SQL storage with neural embeddings
  try {
    const client = new VectorClient();
    if (await client.isHealthy() && await client.isPgvectorEnabled()) {
      const searchText = [record.summary, record.content, ...record.tags].filter(Boolean).join(' ');
      const { embedding } = await embedTextEngine(searchText);
      await client.storeObservation({
        ...record,
        embedding,
      });
      await client.close();
      return record;
    }
    await client.close();
  } catch {
    // Fall through to local vector storage
  }

  // Fallback: local JSON vector index with hashing-bow-v1
  const searchText = [record.summary, record.content, ...record.tags].filter(Boolean).join(' ');
  const embedding = embedText(searchText);
  const vectors = readVectors(rootDir);
  vectors.push({ id, embedding, role: record.role, category: record.category, project: record.project });
  writeVectors(rootDir, vectors.slice(-MAX_INDEX));

  return record;
}

/**
 * Search observations using SQL + neural embeddings when available,
 * falling back to hybrid cosine + BM25 on local JSON.
 */
export async function searchObservations(rootDir, query, {
  role = null,
  category = null,
  project = null,
  limit = 10,
} = {}) {
  if (!query) return [];

  // Try SQL + neural embeddings first
  try {
    const client = new VectorClient();
    if (await client.isHealthy() && await client.isPgvectorEnabled()) {
      const { embedding } = await embedTextEngine(String(query));
      const results = await client.searchObservations({
        project: project || rootDir.split('/').pop(),
        queryEmbedding: embedding,
        limit,
        minSimilarity: 0.1,
        role,
        category,
      });
      await client.close();
      return results.map((r) => ({
        id: r.id,
        role: r.role,
        category: r.category,
        summary: r.summary,
        content: r.content,
        tags: r.tags || [],
        confidence: r.confidence,
        source: r.source,
        createdAt: r.created_at,
        score: r.similarity,
      }));
    }
    await client.close();
  } catch {
    // Fall through to local JSON search
  }

  // Fallback: local JSON + hashing-bow-v1
  const queryEmbedding = embedText(String(query));
  let vectors = readVectors(rootDir);

  if (role) vectors = vectors.filter((v) => v.role === role);
  if (category) vectors = vectors.filter((v) => v.category === category);
  if (project) vectors = vectors.filter((v) => v.project === project);

  // Cosine pass
  const cosineScored = vectors
    .map((v) => ({
      id: v.id,
      score: cosineSimilarity(queryEmbedding, v.embedding || []),
    }))
    .filter(({ score }) => score > 0.05);

  // Load full records for BM25 pass
  const candidateIds = new Set(cosineScored.map((v) => v.id));
  const recentIndex = readIndex(rootDir);
  const filtered = role ? recentIndex.filter((e) => e.role === role) : recentIndex;
  const filteredCat = category ? filtered.filter((e) => e.category === category) : filtered;
  const filteredProj = project ? filteredCat.filter((e) => e.project === project) : filteredCat;
  for (const entry of filteredProj.slice(0, Math.max(limit * 3, 30))) candidateIds.add(entry.id);

  const candidateRecords = [...candidateIds]
    .map((id) => getObservation(rootDir, id))
    .filter(Boolean)
    .map((r) => ({ ...r, text: [r.summary, r.content, ...(r.tags || [])].filter(Boolean).join(' ') }));

  const bm25Scored = rankByBm25(candidateRecords, query, { limit: limit * 2 });

  // Merge: highest score wins per id
  const scoreMap = new Map();
  for (const { id, score } of cosineScored) {
    scoreMap.set(id, score);
  }
  for (const item of bm25Scored) {
    const prev = scoreMap.get(item.id) || 0;
    const bm25Max = bm25Scored[0]?.score || 1;
    const normalized = Math.min(item.score / bm25Max, 1);
    scoreMap.set(item.id, Math.max(prev, normalized));
  }

  return [...scoreMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => {
      const record = getObservation(rootDir, id);
      return record ? { ...record, score } : null;
    })
    .filter(Boolean);
}

/**
 * List observations from the index with optional filters.
 */
export function listObservations(rootDir, {
  role = null,
  category = null,
  project = null,
  limit = 20,
} = {}) {
  let entries = readIndex(rootDir);
  if (role) entries = entries.filter((e) => e.role === role);
  if (category) entries = entries.filter((e) => e.category === category);
  if (project) entries = entries.filter((e) => e.project === project);
  return entries.slice(0, limit);
}

/**
 * Load a full observation record by ID.
 */
export function getObservation(rootDir, id) {
  const filePath = path.join(obsDir(rootDir), `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Delete an observation by id.
 */
export function deleteObservation(rootDir, id) {
  const filePath = path.join(obsDir(rootDir), `${id}.json`);
  if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });

  const index = readIndex(rootDir);
  const filtered = index.filter((e) => e.id !== id);
  if (filtered.length !== index.length) writeIndex(rootDir, filtered);

  const vectors = readVectors(rootDir);
  const filteredVec = vectors.filter((v) => v.id !== id);
  if (filteredVec.length !== vectors.length) writeVectors(rootDir, filteredVec);

  return true;
}

/**
 * Count observations, optionally filtered.
 */
export function countObservations(rootDir, { role = null, project = null } = {}) {
  let entries = readIndex(rootDir);
  if (role) entries = entries.filter((e) => e.role === role);
  if (project) entries = entries.filter((e) => e.project === project);
  return entries.length;
}
