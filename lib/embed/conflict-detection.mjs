/**
 * lib/embed/conflict-detection.mjs — Detect overlaps and contradictions
 * between new intake signals and existing PRDs, ADRs, RFCs.
 *
 * Uses semantic similarity (via lib/embed/semantic.mjs) to compare new
 * signals against the corpus of existing artifacts. Flags potential
 * conflicts when similarity exceeds configurable thresholds.
 *
 * Two detection modes:
 *   1. Overlap detection — new signal addresses same topic as existing artifact
 *   2. Contradiction detection — new signal contradicts a documented decision
 *
 * Storage:
 *   ~/.cx/knowledge/reference/artifact-index.json — cached artifact embeddings
 *   Rebuilt on first use or when artifact file count changes.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { embed, cosineSimilarity, extractTextFromPacket } from './semantic.mjs';
import { listArtifacts } from './artifact.mjs';
import { cxDir } from '../paths.mjs';
import { knowledgeReferenceStore } from '../knowledge/layout.mjs';

function migrateLegacyIndex(indexFile, legacyFile) {
  if (existsSync(indexFile) || !existsSync(legacyFile)) return;
  mkdirSync(join(indexFile, '..'), { recursive: true });
  try { renameSync(legacyFile, indexFile); } catch { /* compatibility-only */ }
}

function indexPaths({ migrate = false } = {}) {
  const indexDir = join(cxDir(), knowledgeReferenceStore());
  const legacyFile = join(cxDir(), 'product-intel', 'artifact-index.json');
  const indexFile = join(indexDir, 'artifact-index.json');
  if (migrate) migrateLegacyIndex(indexFile, legacyFile);
  return {
    indexDir,
    indexFile,
  };
}

const OVERLAP_THRESHOLD = 0.6;
const CONTRADICTION_THRESHOLD = 0.7;
const STALE_INDEX_HOURS = 24;

/**
 * Ensure index directory exists.
 */
function ensureDir() {
  const { indexDir } = indexPaths({ migrate: true });
  if (!existsSync(indexDir)) mkdirSync(indexDir, { recursive: true });
}

let _artifactIndex = null;

/**
 * Build or load the artifact index (cached by count + mtime).
 * Index maps artifact path → { text, embedding, type, title }.
 *
 * @param {object} [opts]
 * @param {string} [opts.rootDir] - Project root
 * @param {boolean} [opts.forceRebuild] - Force rebuild even if cache is fresh
 * @returns {Promise<Array<{ path: string, type: string, title: string, text: string, embedding: Float32Array|null }>>}
 */
export async function buildArtifactIndex({ rootDir, forceRebuild = false } = {}) {
  const root = rootDir || process.cwd();
  ensureDir();

  const artifacts = listArtifacts({ rootDir: root });
  const cacheKey = artifacts.map(a => `${a.relativePath}:${statSync(a.path).mtimeMs}`).join('|');
  const cacheHash = cacheKey.length;

  // Check if cached index is fresh
  const { indexFile } = indexPaths();
  if (!forceRebuild && existsSync(indexFile)) {
    try {
      const cached = JSON.parse(readFileSync(indexFile, 'utf8'));
      if (cached.cacheHash === cacheHash && cached.index?.length === artifacts.length) {
        const age = Date.now() - new Date(cached.builtAt).getTime();
        if (age < STALE_INDEX_HOURS * 60 * 60 * 1000) {
          _artifactIndex = cached.index;
          return _artifactIndex;
        }
      }
    } catch { /* rebuild */ }
  }

  // Build index — read artifact files, extract text, generate embeddings
  const index = [];
  for (const artifact of artifacts) {
    try {
      const content = readFileSync(artifact.path, 'utf8');
      const text = extractArtifactText(content, artifact);
      const vector = await embed(text);
      index.push({
        path: artifact.relativePath,
        type: artifact.type,
        title: artifact.title,
        status: artifact.status,
        text: text.slice(0, 2000),
        embedding: vector ? Array.from(vector) : null,
      });
    } catch {
      // skip unreadable artifacts
    }
  }

  _artifactIndex = index;

  // Persist index (without large embeddings if too many)
  const persistent = index.map(a => ({
    ...a,
    embedding: a.embedding ? Array.from(a.embedding) : null,
  }));

  writeFileSync(indexFile, JSON.stringify({
    cacheHash,
    builtAt: new Date().toISOString(),
    artifactCount: artifacts.length,
    index: persistent,
  }, null, 2) + '\n');

  return index;
}

/**
 * Extract searchable text from an artifact file.
 *
 * @param {string} content - Raw markdown content
 * @param {object} artifact - Artifact metadata
 * @returns {string} Cleaned text for embedding
 */
function extractArtifactText(content, artifact) {
  // Strip frontmatter
  const body = content.replace(/^---[\s\S]*?---\n*/, '');

  // Extract key sections based on type
  const title = artifact.title || '';
  const type = artifact.type || '';

  const sections = [];

  if (type === 'adr') {
    const context = body.match(/## Context\s*\n([\s\S]*?)(?=^## )/m)?.[1] || '';
    const decision = body.match(/## Decision\s*\n([\s\S]*?)(?=^## )/m)?.[1] || '';
    sections.push(title, context, decision);
  } else if (type === 'prd') {
    const problem = body.match(/## Problem\s*\n([\s\S]*?)(?=^## )/m)?.[1] || '';
    const goals = body.match(/## Goals\s*\n([\s\S]*?)(?=^## )/m)?.[1] || '';
    sections.push(title, problem, goals);
  } else if (type === 'rfc') {
    const summary = body.match(/## Summary\s*\n([\s\S]*?)(?=^## )/m)?.[1] || '';
    const motivation = body.match(/## Motivation\s*\n([\s\S]*?)(?=^## )/m)?.[1] || '';
    sections.push(title, summary, motivation);
  } else {
    // Generic — use first 2000 chars
    sections.push(title, body.slice(0, 2000));
  }

  return sections.filter(Boolean).join('\n').slice(0, 3000);
}

/**
 * Check a new intake signal for potential conflicts with existing artifacts.
 *
 * @param {object} packet - Intake packet with triage, excerpt
 * @param {object} [opts]
 * @param {string} [opts.rootDir]
 * @param {number} [opts.overlapThreshold=0.6]
 * @param {number} [opts.contradictionThreshold=0.7]
 * @returns {Promise<Array<{ type: 'overlap'|'contradiction', severity: string, artifact: string, similarity: number, summary: string }>>}
 */
export async function detectConflicts(packet, { rootDir, overlapThreshold = OVERLAP_THRESHOLD, contradictionThreshold = CONTRADICTION_THRESHOLD } = {}) {
  const text = extractTextFromPacket(packet);
  if (!text) return [];

  const signalVec = await embed(text);
  if (!signalVec) return [];

  const index = await buildArtifactIndex({ rootDir });
  const conflicts = [];

  for (const entry of index) {
    if (!entry.embedding) continue;
    const entryVec = new Float32Array(entry.embedding);
    const sim = cosineSimilarity(signalVec, entryVec);

    if (sim >= overlapThreshold) {
      // Determine if this is overlap or potential contradiction
      const isAdr = entry.type === 'adr';
      const isContradictory = isAdr && sim >= contradictionThreshold;

      conflicts.push({
        type: isContradictory ? 'contradiction' : 'overlap',
        severity: sim >= 0.8 ? 'high' : sim >= 0.7 ? 'medium' : 'low',
        artifact: entry.path,
        artifactType: entry.type,
        title: entry.title,
        status: entry.status,
        similarity: Number(sim.toFixed(3)),
        summary: isContradictory
          ? `Potential contradiction with ${entry.type.toUpperCase()}-${entry.title} (similarity: ${sim.toFixed(2)})`
          : `Overlaps with ${entry.type.toUpperCase()}-${entry.title} (similarity: ${sim.toFixed(2)})`,
      });
    }
  }

  return conflicts.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Scan all pending intake items for inter-item conflicts
 * (two items addressing same topic from different angles).
 *
 * @param {Array<object>} pendingPackets
 * @param {object} [opts]
 * @param {number} [opts.threshold=0.7]
 * @returns {Promise<Array<{ itemA: string, itemB: string, similarity: number, summary: string }>>}
 */
export async function detectInterItemConflicts(pendingPackets, { threshold = 0.7 } = {}) {
  if (pendingPackets.length < 2) return [];

  const items = [];
  for (const packet of pendingPackets) {
    const text = extractTextFromPacket(packet);
    if (!text) continue;
    const vector = await embed(text);
    if (vector) {
      items.push({ id: packet.id, text, embedding: vector });
    }
  }

  const conflicts = [];
  for (let i = 1; i < items.length; i++) {
    for (let j = 0; j < i; j++) {
      const sim = cosineSimilarity(items[i].embedding, items[j].embedding);
      if (sim >= threshold) {
        conflicts.push({
          itemA: items[i].id,
          itemB: items[j].id,
          similarity: Number(sim.toFixed(3)),
          summary: `Intake items conflict: ${items[i].id.slice(0, 20)} vs ${items[j].id.slice(0, 20)} (${(sim * 100).toFixed(0)}% similar)`,
        });
      }
    }
  }

  return conflicts.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Reset the cached artifact index (call when artifacts change).
 */
export function resetArtifactIndex() {
  _artifactIndex = null;
  const { indexFile } = indexPaths();
  if (existsSync(indexFile)) {
    try { unlinkSync(indexFile); } catch { /* ignore */ }
  }
}

/**
 * Get artifact index stats.
 *
 * @param {object} [opts]
 * @param {string} [opts.rootDir]
 * @returns {Promise<{ total: number, byType: object, cached: boolean }>}
 */
export async function artifactIndexStats({ rootDir } = {}) {
  const index = await buildArtifactIndex({ rootDir });
  const byType = {};
  for (const entry of index) {
    byType[entry.type] = (byType[entry.type] || 0) + 1;
  }
  return {
    total: index.length,
    byType,
    indexed: index.filter(e => e.embedding).length,
    cached: _artifactIndex !== null,
  };
}
