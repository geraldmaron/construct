/**
 * lib/observation-store.mjs — Role-scoped observation store with vector indexing.
 *
 * Stores distilled insights that specialists learn during work:
 *   - patterns, anti-patterns, dependency relationships, decisions, insights
 *   - each scoped to a role (cx-engineer, cx-architect, etc.)
 *   - vector-indexed for semantic search via embedded LanceDB
 *
 * Storage layout:
 *   .cx/observations/index.json      — lightweight listing for fast filtering
 *   .cx/observations/<id>.json       — full observation record
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { embedText as embedTextEngine } from './storage/embeddings-engine.mjs';
import { VectorClient } from './storage/vector-client.mjs';
import { ensureCxDir } from './project-init-shared.mjs';

const OBS_DIR = '.cx/observations';
const INDEX_FILE = 'index.json';
const MAX_INDEX = 1000;

// VectorClient resolves its store from CONSTRUCT_LANCEDB_PATH and otherwise
// falls back to process.cwd(). Observations are scoped to rootDir, so when no
// explicit path is configured (tests, unmanaged checkouts) the vector store
// must follow rootDir — not the caller's cwd — or a reader in a different cwd
// than the writer sees an empty table. A configured path (managed installs)
// is left untouched so the home-global store keeps working.

function vectorClientFor(rootDir) {
  const env = process.env.CONSTRUCT_LANCEDB_PATH
    ? process.env
    : { ...process.env, CONSTRUCT_LANCEDB_PATH: path.join(rootDir, '.cx', 'lancedb') };
  return new VectorClient({ env });
}

export function observationSearchText(obs) {
  return [obs.summary, obs.content, ...(obs.tags || [])].filter(Boolean).join(' ');
}

export function observationContentHash(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}
const MAX_SUMMARY = 500;
const MAX_CONTENT = 2000;
const MAX_TAGS = 10;
const MAX_BYTES = 50 * 1024 * 1024;

const VALID_CATEGORIES = new Set([
  'pattern', 'anti-pattern', 'dependency', 'decision', 'insight', 'session-summary',
]);

function ensureDir(dir, rootDir = null) {
  if (rootDir) ensureCxDir(rootDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function obsDir(rootDir) {
  return path.join(rootDir, OBS_DIR);
}

function indexPath(rootDir) {
  return path.join(obsDir(rootDir), INDEX_FILE);
}

function generateId() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString('hex');
  return `obs-${ts}-${rand}`;
}

const MAX_EXTRAS_BYTES = 2 * 1024;

function sanitizeExtras(extras) {
  if (extras == null) return null;
  if (typeof extras !== 'object' || Array.isArray(extras)) return null;
  try {
    const serialized = JSON.stringify(extras);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_EXTRAS_BYTES) return null;
    return JSON.parse(serialized);
  } catch {
    return null;
  }
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

function logCapDrop(rootDir, kind, dropped, total) {
  if (dropped <= 0) return;
  try {
    const logPath = path.join(rootDir, '.cx', 'observation-cap-warnings.jsonl');
    ensureCxDir(rootDir);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      kind,
      dropped,
      total,
      cap: MAX_INDEX,
      remedy: "Run 'construct memory consolidate' to compact stored observations.",
    });
    fs.appendFileSync(logPath, entry + '\n');
  } catch { /* cap warnings are best-effort */ }
}

function writeIndex(rootDir, entries) {
  ensureDir(obsDir(rootDir), rootDir);
  const trimmed = entries.slice(0, MAX_INDEX);
  const dropped = Math.max(0, entries.length - MAX_INDEX);
  if (dropped > 0) {
    logCapDrop(rootDir, 'observation-index', dropped, entries.length);
  }
  fs.writeFileSync(indexPath(rootDir), JSON.stringify(trimmed, null, 2) + '\n');
  return { dropped };
}

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
  extras = null,
} = {}) {
  const id = generateId();
  const now = new Date().toISOString();

  const effectiveCategory = VALID_CATEGORIES.has(category) ? category : 'insight';
  const clampedSummary = clamp(String(summary), MAX_SUMMARY);
  const clampedContent = clamp(String(content), MAX_CONTENT);
  const clampedTags = (Array.isArray(tags) ? tags : []).slice(0, MAX_TAGS).map(String);
  const clampedExtras = sanitizeExtras(extras);

  const effectiveProject = project ? String(project) : rootDir.split('/').pop();
  const record = {
    id,
    role: String(role),
    category: effectiveCategory,
    summary: clampedSummary,
    content: clampedContent,
    tags: clampedTags,
    project: effectiveProject,
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0.8)),
    source: source || null,
    gitSha: gitSha ? String(gitSha).slice(0, 40) : null,
    extras: clampedExtras,
    createdAt: now,
    updatedAt: now,
  };

  ensureDir(obsDir(rootDir), rootDir);
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
  const indexDropped = writeIndex(rootDir, index).dropped;
  if (indexDropped > 0) {
    record.capDropped = indexDropped;
    process.stderr.write(`[observation-store] observation cap reached: ${indexDropped} oldest entries evicted (cap=${MAX_INDEX})\n`);
  }

  try {
    const client = vectorClientFor(rootDir);
    if (await client.isHealthy()) {
      const searchText = observationSearchText(record);
      const { embedding, model } = await embedTextEngine(searchText);
      await client.storeObservation({
        ...record,
        embedding,
        contentHash: observationContentHash(searchText),
        model,
      });
    }
    await client.close();
  } catch (err) {
    process.stderr.write(`[observation-store] vector store failed; kept observation in local index: ${err?.message || err}\n`);
  }

  return record;
}

export async function searchObservations(rootDir, query, {
  role = null,
  category = null,
  project = null,
  limit = 10,
} = {}) {
  if (!query) return [];

  try {
    const client = vectorClientFor(rootDir);
    if (await client.isHealthy()) {
      const { embedding } = await embedTextEngine(String(query));
      const results = await client.searchObservations({
        project: project || rootDir.split('/').pop(),
        queryEmbedding: embedding,
        limit,
        minSimilarity: 0.01,
        role,
        category,
      });
      await client.close();
      return results.map((r) => ({
        id: r.id,
        role: r.role,
        category: r.category,
        project: r.project,
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
    // If Vector search fails, return empty since fallback is removed.
  }

  return [];
}

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

export function getObservation(rootDir, id) {
  const filePath = path.join(obsDir(rootDir), `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function deleteObservation(rootDir, id) {
  const filePath = path.join(obsDir(rootDir), `${id}.json`);
  if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });

  const index = readIndex(rootDir);
  const filtered = index.filter((e) => e.id !== id);
  if (filtered.length !== index.length) writeIndex(rootDir, filtered);

  return true;
}

export function countObservations(rootDir, { role = null, project = null } = {}) {
  let entries = readIndex(rootDir);
  if (role) entries = entries.filter((e) => e.role === role);
  if (project) entries = entries.filter((e) => e.project === project);
  return entries.length;
}

export function getObservationsSize(rootDir) {
  const root = obsDir(rootDir);
  if (!fs.existsSync(root)) return 0;
  let total = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        try { total += fs.statSync(full).size; } catch { /* best effort */ }
      }
    }
  };
  walk(root);
  return total;
}

export function checkObservationsSize(rootDir, { cap = MAX_BYTES } = {}) {
  const size = getObservationsSize(rootDir);
  return { size, cap, ok: size <= cap };
}