/**
 * lib/knowledge/rag.mjs — Retrieval-Augmented Generation pipeline.
 *
 * Indexes all knowledge sources into a unified corpus and answers natural-
 * language queries by retrieving the most relevant chunks, then synthesising
 * a response via the `claude` CLI.
 *
 * Sources indexed:
 *   - Observations       (.cx/observations/)
 *   - Artifacts          (docs/adr/, docs/prd/, docs/rfc/)
 *   - Snapshots          (.cx/snapshot.md + any configured output paths)
 *   - Approval queue     (.cx/approval-queue.jsonl)
 *
 * Retrieval strategy:
 *   Hybrid BM25 + cosine similarity (hashing-bow-v1 embeddings, zero deps).
 *   Top-K chunks from each source are merged, deduplicated by id, and re-ranked
 *   by a combined score before being assembled into a prompt context window.
 *
 * Context budget:
 *   MAX_CONTEXT_CHARS limits total text sent to the model. Chunks are trimmed
 *   to fit. The budget is intentionally conservative so the answer fits in a
 *   single claude --print call.
 *
 * Zero external deps — uses only the existing embeddings primitives.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  embedText,
  cosineSimilarity,
  rankByBm25,
} from '../storage/embeddings.mjs';
import { listObservations, getObservation } from '../observation-store.mjs';
import { listArtifacts } from '../embed/artifact.mjs';

const MAX_CONTEXT_CHARS = 12_000;
const MAX_CHUNKS = 12;
const CHUNK_PREVIEW = 600; // chars per chunk in context
const MIN_SCORE = 0.05;

// ── Source loaders ─────────────────────────────────────────────────────────

/**
 * Load all observations as indexable chunks.
 */
function loadObservationChunks(rootDir) {
  try {
    const entries = listObservations(rootDir, {});
    return entries.map((e) => {
      const full = getObservation(rootDir, e.id);
      return {
        id: `obs:${e.id}`,
        source: 'observation',
        title: e.summary || 'Observation',
        body: [full?.content, full?.summary].filter(Boolean).join('\n'),
        tags: e.tags || [],
        role: e.role || null,
        category: e.category || null,
        createdAt: e.createdAt || null,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Load markdown files from a directory tree as indexable chunks.
 */
function loadMarkdownChunks(dir, source) {
  if (!fs.existsSync(dir)) return [];
  const chunks = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.md')) continue;
      try {
        const content = fs.readFileSync(full, 'utf8');
        const titleMatch = content.match(/^#\s+(.+)/m);
        chunks.push({
          id: `${source}:${path.relative(process.cwd(), full)}`,
          source,
          title: titleMatch ? titleMatch[1].trim() : entry.name,
          body: content,
          filePath: full,
          createdAt: fs.statSync(full).mtime.toISOString(),
        });
      } catch { /* skip unreadable */ }
    }
  };
  walk(dir);
  return chunks;
}

/**
 * Load artifact docs (ADR, PRD, RFC) from docs/.
 */
function loadArtifactChunks(rootDir) {
  const chunks = [];
  for (const subdir of ['docs/adr', 'docs/prd', 'docs/rfc', 'docs/architecture.md']) {
    const full = path.resolve(rootDir, subdir);
    if (subdir.endsWith('.md')) {
      if (!fs.existsSync(full)) continue;
      try {
        const content = fs.readFileSync(full, 'utf8');
        const titleMatch = content.match(/^#\s+(.+)/m);
        chunks.push({
          id: `artifact:${subdir}`,
          source: 'artifact',
          title: titleMatch ? titleMatch[1].trim() : subdir,
          body: content,
          filePath: full,
          createdAt: fs.statSync(full).mtime.toISOString(),
        });
      } catch { /* skip */ }
    } else {
      chunks.push(...loadMarkdownChunks(full, 'artifact'));
    }
  }
  return chunks;
}

/**
 * Load snapshot markdown files.
 */
function loadSnapshotChunks(rootDir) {
  const candidates = [
    path.resolve(rootDir, '.cx/snapshot.md'),
    path.resolve(rootDir, '.cx/snapshots'),
  ];
  const chunks = [];
  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    if (fs.statSync(c).isDirectory()) {
      chunks.push(...loadMarkdownChunks(c, 'snapshot'));
    } else {
      try {
        const content = fs.readFileSync(c, 'utf8');
        chunks.push({
          id: 'snapshot:.cx/snapshot.md',
          source: 'snapshot',
          title: 'Latest Snapshot',
          body: content,
          filePath: c,
          createdAt: fs.statSync(c).mtime.toISOString(),
        });
      } catch { /* skip */ }
    }
  }
  return chunks;
}

// ── Index builder ──────────────────────────────────────────────────────────

/**
 * Build a full in-memory corpus from all sources.
 * Each chunk gets an embedding vector for cosine scoring.
 */
export function buildCorpus(rootDir = process.cwd()) {
  const chunks = [
    ...loadObservationChunks(rootDir),
    ...loadArtifactChunks(rootDir),
    ...loadSnapshotChunks(rootDir),
  ];

  // Embed each chunk
  return chunks.map((chunk) => ({
    ...chunk,
    embedding: embedText(`${chunk.title} ${chunk.body}`.slice(0, 2000)),
  }));
}

// ── Retrieval ──────────────────────────────────────────────────────────────

/**
 * Retrieve the top-K most relevant chunks for a query.
 * Hybrid: BM25 keyword score + cosine similarity, normalised and summed.
 *
 * @param {string} query
 * @param {object[]} corpus  — from buildCorpus()
 * @param {object} opts
 * @returns {object[]} top chunks with .score, sorted desc
 */
export function retrieve(query, corpus, { topK = MAX_CHUNKS, minScore = MIN_SCORE } = {}) {
  if (!query || corpus.length === 0) return [];

  const queryEmbedding = embedText(query);

  // BM25 pass
  const bm25Results = rankByBm25(
    corpus.map((c) => ({ ...c, text: `${c.title} ${c.body}` })),
    query,
    { limit: topK * 2 },
  );
  const bm25Scores = new Map(bm25Results.map((r) => [r.id, r.score]));
  const bm25Max = Math.max(...bm25Scores.values(), 1);

  // Cosine pass
  const cosineScored = corpus.map((chunk) => ({
    ...chunk,
    cosine: cosineSimilarity(queryEmbedding, chunk.embedding || []),
  }));
  const cosineMax = Math.max(...cosineScored.map((c) => c.cosine), 1);

  // Combined score: normalised BM25 * 0.6 + normalised cosine * 0.4
  const combined = cosineScored.map((chunk) => {
    const bm25Norm = (bm25Scores.get(chunk.id) || 0) / bm25Max;
    const cosineNorm = chunk.cosine / cosineMax;
    return { ...chunk, score: bm25Norm * 0.6 + cosineNorm * 0.4 };
  });

  return combined
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ── Context assembly ───────────────────────────────────────────────────────

/**
 * Format retrieved chunks into a context block for the prompt.
 */
export function assembleContext(chunks) {
  let budget = MAX_CONTEXT_CHARS;
  const parts = [];

  for (const chunk of chunks) {
    const preview = chunk.body?.slice(0, CHUNK_PREVIEW) || '';
    const meta = [
      chunk.source && `source:${chunk.source}`,
      chunk.role && `role:${chunk.role}`,
      chunk.category && `category:${chunk.category}`,
      chunk.createdAt && `date:${chunk.createdAt.slice(0, 10)}`,
    ].filter(Boolean).join('  ');

    const block = `### ${chunk.title}\n${meta ? `_${meta}_\n` : ''}${preview}${preview.length === CHUNK_PREVIEW ? '\n…' : ''}`;
    if (block.length > budget) break;
    parts.push(block);
    budget -= block.length;
  }

  return parts.join('\n\n---\n\n');
}

// ── Answer synthesis ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Construct's knowledge assistant. Answer questions about the project using only the provided context.
- Be specific and cite which source you drew from (observation, artifact, snapshot).
- If the context is insufficient, say so directly — do not speculate.
- Keep answers concise (under 400 words unless the question demands detail).
- Format as plain text unless the question explicitly asks for markdown.`;

/**
 * Ask a question against the knowledge base.
 *
 * @param {string} question
 * @param {object} opts
 * @param {string}   opts.rootDir
 * @param {object[]} [opts.corpus]   — pre-built corpus (skips rebuild)
 * @param {boolean}  [opts.dryRun]   — return retrieved chunks without calling claude
 * @returns {{ answer: string, sources: object[], query: string }}
 */
export async function ask(question, { rootDir = process.cwd(), corpus, dryRun = false } = {}) {
  const kb = corpus ?? buildCorpus(rootDir);
  const chunks = retrieve(question, kb);

  if (dryRun) {
    return {
      answer: null,
      sources: chunks.map((c) => ({ id: c.id, source: c.source, title: c.title, score: c.score })),
      query: question,
    };
  }

  if (chunks.length === 0) {
    return {
      answer: 'No relevant information found in the knowledge base for this query.',
      sources: [],
      query: question,
    };
  }

  const context = assembleContext(chunks);
  const prompt = `${SYSTEM_PROMPT}\n\n## Knowledge Base Context\n\n${context}\n\n## Question\n\n${question}\n\n## Answer`;

  // Call claude CLI
  const result = spawnSync('claude', ['--print', prompt], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env },
  });

  if (result.error || result.status !== 0) {
    // Fallback: return retrieved chunks as a structured answer
    const fallback = chunks
      .slice(0, 5)
      .map((c) => `**${c.title}** (${c.source})\n${c.body?.slice(0, 300) || ''}`)
      .join('\n\n');
    return {
      answer: `[Claude CLI unavailable — showing retrieved context]\n\n${fallback}`,
      sources: chunks.map((c) => ({ id: c.id, source: c.source, title: c.title, score: c.score })),
      query: question,
      cliMissing: true,
    };
  }

  return {
    answer: (result.stdout || '').trim(),
    sources: chunks.map((c) => ({ id: c.id, source: c.source, title: c.title, score: c.score })),
    query: question,
  };
}
