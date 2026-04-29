/**
 * lib/knowledge/search.mjs — Self-knowledge search for Construct's own docs.
 *
 * Answers questions about what Construct is, how it works, and what it can do
 * by reading Construct's own documentation tree. Designed for the
 * `knowledge_search` MCP tool — no daemon, no network, no external deps.
 *
 * Sources searched (in priority order):
 *   1. docs/architecture.md  — system overview, layers, capabilities
 *   2. docs/README.md        — index, how-to guides
 *   3. docs/getting-started.md
 *   4. .cx/knowledge/        — operator-written internal docs
 *   5. Any *.md in docs/how-to/
 *
 * Retrieval strategy:
 *   Token-based BM25-like scoring over 200-char chunks. Returns top-K chunks
 *   with their source file and a relevance score. Pure text — no embeddings.
 *
 * @module lib/knowledge/search
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { homedir } from 'node:os';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(MODULE_DIR, '..', '..');

// ─── Source catalogue ────────────────────────────────────────────────────────

/** Priority-ordered list of source files to search. */
function buildSourceList(repoRoot = REPO_ROOT) {
  const sources = [];

  const priority = [
    'docs/architecture.md',
    'docs/README.md',
    'docs/getting-started.md',
    'docs/prompt-surfaces.md',
    'docs/knowledge-layout.md',
  ];

  for (const rel of priority) {
    const full = join(repoRoot, rel);
    if (existsSync(full)) sources.push({ path: full, rel, priority: 1 });
  }

  // How-to guides
  const howToDir = join(repoRoot, 'docs', 'how-to');
  if (existsSync(howToDir)) {
    for (const file of readdirSync(howToDir)) {
      if (file.endsWith('.md')) {
        const full = join(howToDir, file);
        sources.push({ path: full, rel: `docs/how-to/${file}`, priority: 2 });
      }
    }
  }

  // Operator internal knowledge
  const knowledgeDirs = [
    join(repoRoot, '.cx', 'knowledge', 'internal'),
    join(repoRoot, '.cx', 'knowledge', 'reference'),
    join(repoRoot, '.cx', 'knowledge', 'how-tos'),
  ];
  for (const dir of knowledgeDirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.md')) {
        const full = join(dir, file);
        sources.push({ path: full, rel: relative(repoRoot, full), priority: 3 });
      }
    }
  }

  return sources;
}

// ─── Chunking ────────────────────────────────────────────────────────────────

const CHUNK_CHARS = 400;
const CHUNK_OVERLAP = 80;

/**
 * Split text into overlapping chunks, preserving markdown section boundaries
 * where possible. Each chunk carries the nearest preceding heading as context.
 */
function chunkText(text, source) {
  const chunks = [];
  const lines = text.split('\n');
  let heading = '';
  let buffer = '';
  let bufferStart = 0;

  function flush(lineIdx) {
    const trimmed = buffer.trim();
    if (trimmed.length < 20) return;
    chunks.push({ text: trimmed, heading, source, lineStart: bufferStart });
    // Overlap: carry last CHUNK_OVERLAP chars into the next buffer
    buffer = trimmed.length > CHUNK_OVERLAP ? trimmed.slice(-CHUNK_OVERLAP) : trimmed;
    bufferStart = lineIdx;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,3}\s/.test(line)) {
      // Section boundary — flush current buffer, update heading
      flush(i);
      heading = line.replace(/^#+\s*/, '').trim();
      buffer = line + '\n';
      bufferStart = i;
    } else {
      buffer += line + '\n';
      if (buffer.length >= CHUNK_CHARS) flush(i);
    }
  }
  flush(lines.length);
  return chunks;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Tokenise text into lowercase words, filtering stop words.
 */
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'is', 'are', 'it', 'in',
  'of', 'to', 'for', 'with', 'on', 'at', 'by', 'from', 'that', 'this',
  'be', 'as', 'was', 'will', 'can', 'its', 'not', 'you', 'your', 'how']);

function tokenise(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP.has(t));
}

/**
 * BM25-inspired score: term frequency in chunk × inverse source frequency ×
 * source priority bonus.
 */
function scoreChunk(chunk, queryTokens, idfMap) {
  const chunkTokens = tokenise(chunk.text);
  const tf = new Map();
  for (const t of chunkTokens) tf.set(t, (tf.get(t) ?? 0) + 1);

  let score = 0;
  for (const qt of queryTokens) {
    const freq = tf.get(qt) ?? 0;
    if (freq > 0) {
      const idf = idfMap.get(qt) ?? 1;
      // BM25 k1=1.5, b=0 (no length normalisation — chunks are pre-sized)
      score += idf * (freq * 2.5) / (freq + 1.5);
    }
    // Heading match bonus
    if (chunk.heading.toLowerCase().includes(qt)) score += 2;
    // File-name match bonus — rewards architecture.md for "architecture" queries
    if (chunk.source.rel.toLowerCase().includes(qt)) score += 1.5;
  }

  // Priority bonus: priority-1 (architecture, README) wins decisively over how-tos.
  // Multiplier is additive-style: add a flat boost so low-scoring priority-1 chunks
  // aren't simply outscored by high-TF how-to chunks.
  if (chunk.source.priority === 1) score += 3;
  else if (chunk.source.priority === 2) score *= 1.05;

  return score;
}

function buildIdf(queryTokens, chunks) {
  const idf = new Map();
  const N = chunks.length || 1;
  for (const qt of queryTokens) {
    const df = chunks.filter(c => tokenise(c.text).includes(qt)).length || 1;
    idf.set(qt, Math.log((N - df + 0.5) / (df + 0.5) + 1));
  }
  return idf;
}

// ─── Observation store loader ────────────────────────────────────────────────

/**
 * Load distilled embed observations from `<rootDir>/.cx/observations/` and
 * convert each one into a searchable text chunk. Returns [] if the directory
 * doesn't exist or is empty.
 */
function buildObservationChunks(rootDir) {
  const obsDir = join(rootDir, '.cx', 'observations');
  if (!existsSync(obsDir)) return [];

  const chunks = [];
  let files;
  try { files = readdirSync(obsDir).filter(f => f.endsWith('.json')); } catch { return []; }

  for (const file of files) {
    let obs;
    try { obs = JSON.parse(readFileSync(join(obsDir, file), 'utf8')); } catch { continue; }
    if (!obs || typeof obs !== 'object') continue;

    const parts = [];
    if (obs.summary) parts.push(obs.summary);
    if (obs.content && obs.content !== obs.summary) parts.push(obs.content);
    if (Array.isArray(obs.tags) && obs.tags.length) parts.push(`tags: ${obs.tags.join(', ')}`);

    const text = parts.join('\n').trim();
    if (!text) continue;

    chunks.push({
      text,
      heading: obs.summary ?? '',
      source: { path: join(obsDir, file), rel: `observations/${file}`, priority: 2 },
      lineStart: 0,
    });
  }

  return chunks;
}


/**
 * @typedef {object} KnowledgeSearchResult
 * @property {boolean} ok
 * @property {string} query
 * @property {number} totalChunks
 * @property {SearchHit[]} hits
 * @property {string[]} sources  — unique source files that contributed hits
 * @property {string} [message]
 */

/**
 * @typedef {object} SearchHit
 * @property {string} text
 * @property {string} heading
 * @property {string} file    — repo-relative path
 * @property {number} score
 * @property {number} lineStart
 */

/**
 * Search Construct's own documentation for content relevant to `query`.
 *
 * @param {object} opts
 * @param {string} opts.query          — natural-language question or keyword
 * @param {number} [opts.topK=5]       — max hits to return
 * @param {number} [opts.minScore=0.1] — discard hits below this score
 * @param {string} [opts.repoRoot]     — override repo root (for testing)
 * @param {string} [opts.rootDir]      — data dir where .cx/observations/ lives (default: homedir())
 * @returns {KnowledgeSearchResult}
 */
export function knowledgeSearch({ query, topK = 5, minScore = 0.1, repoRoot, rootDir } = {}) {
  if (!query || typeof query !== 'string') {
    return { ok: false, query: query ?? '', totalChunks: 0, hits: [], sources: [], message: 'query is required' };
  }

  const root = repoRoot ?? REPO_ROOT;
  const dataDir = rootDir ?? (process.env.CX_DATA_DIR?.trim() || homedir());
  const sources = buildSourceList(root);

  // Build corpus from docs + operator knowledge
  const allChunks = [];
  for (const src of sources) {
    let text = '';
    try { text = readFileSync(src.path, 'utf8'); } catch { continue; }
    const chunks = chunkText(text, src);
    allChunks.push(...chunks);
  }

  // Add distilled embed observations from the data dir
  const obsChunks = buildObservationChunks(dataDir);
  allChunks.push(...obsChunks);

  if (!allChunks.length) {
    return { ok: false, query, totalChunks: 0, hits: [], sources: [], message: 'No documentation or observation sources found' };
  }

  const queryTokens = tokenise(query);
  if (!queryTokens.length) {
    return { ok: false, query, totalChunks: allChunks.length, hits: [], sources: [], message: 'Query contains no searchable terms after stop-word removal' };
  }

  const idf = buildIdf(queryTokens, allChunks);

  const scored = allChunks
    .map(chunk => ({ chunk, score: scoreChunk(chunk, queryTokens, idf) }))
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const hits = scored.map(({ chunk, score }) => ({
    text: chunk.text,
    heading: chunk.heading,
    file: chunk.source.rel,
    score: Math.round(score * 100) / 100,
    lineStart: chunk.lineStart,
  }));

  const uniqueSources = [...new Set(hits.map(h => h.file))];

  return {
    ok: true,
    query,
    totalChunks: allChunks.length,
    hits,
    sources: uniqueSources,
    message: hits.length
      ? `Found ${hits.length} relevant excerpt${hits.length === 1 ? '' : 's'} across ${uniqueSources.length} source${uniqueSources.length === 1 ? '' : 's'}`
      : 'No relevant content found — try broader terms',
  };
}
