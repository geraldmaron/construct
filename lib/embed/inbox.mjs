/**
 * lib/embed/inbox.mjs — filesystem inbox watcher for the embed daemon.
 *
 * Watches one or more local directories for new ingestable files and
 * processes them into the observation store. Agnostic to content type —
 * handles specs, ADRs, meeting notes, internal docs, research, PDFs,
 * Office files, plain text, code, or any format supported by document-extract.
 *
 * Watch dirs (in priority order):
 *   1. CX_INBOX_DIRS env var — colon-separated absolute paths
 *   2. <rootDir>/.cx/inbox/  — per-project drop folder (always included)
 *
 * State tracking:
 *   <rootDir>/.cx/runtime/inbox-state.json — maps filePath → processedAt
 *   Prevents re-processing the same file across daemon restarts.
 *
 * Usage:
 *   const watcher = new InboxWatcher({ rootDir, env });
 *   const result  = await watcher.poll();
 *   // result: { processed: [...], skipped: number, errors: [...] }
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { isExtractableDocumentPath } from '../document-extract.mjs';
import { ingestDocuments } from '../document-ingest.mjs';
import { addObservation } from '../observation-store.mjs';
import { inferKnowledgeTarget, knowledgeDirForCategory } from '../knowledge/layout.mjs';

const STATE_FILE = '.cx/runtime/inbox-state.json';
const DEFAULT_INBOX_SUBDIR = '.cx/inbox';
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB hard cap

// ─── State helpers ────────────────────────────────────────────────────────────

function statePath(rootDir) {
  return join(rootDir, STATE_FILE);
}

function readState(rootDir) {
  const p = statePath(rootDir);
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}

function writeState(rootDir, state) {
  const p = statePath(rootDir);
  mkdirSync(join(rootDir, '.cx', 'runtime'), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2) + '\n');
}

// ─── Directory resolution ─────────────────────────────────────────────────────

/**
 * Resolve inbox watch directories.
 * Always includes <rootDir>/.cx/inbox/ (created on first use).
 * CX_INBOX_DIRS adds extra absolute paths from the local filesystem.
 */
export function resolveInboxDirs(rootDir, env = process.env) {
  const dirs = [];

  // Always include the per-project inbox dir
  const projectInbox = join(rootDir, DEFAULT_INBOX_SUBDIR);
  mkdirSync(projectInbox, { recursive: true });
  dirs.push(projectInbox);

  // Additional dirs from env
  const raw = (env.CX_INBOX_DIRS ?? '').trim();
  if (raw) {
    for (const part of raw.split(':')) {
      const p = part.trim();
      if (!p) continue;
      const abs = isAbsolute(p) ? p : resolve(rootDir, p);
      if (existsSync(abs) && !dirs.includes(abs)) dirs.push(abs);
    }
  }

  return dirs;
}

// ─── File scanning ────────────────────────────────────────────────────────────

function scanDir(dir) {
  const results = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (!isExtractableDocumentPath(full)) continue;
      try {
        const st = statSync(full);
        if (st.size === 0 || st.size > MAX_FILE_SIZE_BYTES) continue;
        results.push({ path: full, size: st.size, mtimeMs: st.mtimeMs });
      } catch { /* unreadable */ }
    }
  } catch { /* unreadable dir */ }
  return results;
}

// ─── Observation extraction ───────────────────────────────────────────────────

/**
 * Derive observation category and knowledge subdir from a file path.
 * Uses inferKnowledgeTarget for routing, then maps subdir → obs category.
 */
function inferFileClassification(filePath) {
  const knowledgeSubdir = inferKnowledgeTarget(filePath);
  // Map subdir to observation category
  let category;
  switch (knowledgeSubdir) {
    case 'decisions': category = 'decision';     break;
    case 'how-tos':   category = 'pattern';      break;
    case 'reference': category = 'insight';      break;
    case 'external':  category = 'insight';      break;
    default:          category = 'insight';
  }
  // Postmortem / incident files deserve anti-pattern category regardless of subdir
  const name = filePath.toLowerCase();
  if (/\bpost.?mortem\b|\bincident\b|\brca\b/.test(name)) category = 'anti-pattern';
  return { category, knowledgeSubdir };
}

/**
 * Write an observation summarising the ingested document.
 * Summary = first non-empty line of extracted text (≤120 chars).
 * Content = first 1500 chars of extracted text for RAG searchability.
 */
function recordInboxObservation(rootDir, { sourcePath, outputPath, characters, extractedText, category, knowledgeSubdir }) {
  const lines = (extractedText ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const firstLine = (lines[0] ?? '').slice(0, 120);
  const filename = sourcePath.split('/').pop();
  const summary = firstLine
    ? `[inbox] ${filename}: ${firstLine}`
    : `[inbox] Ingested document: ${filename}`;
  const content = (extractedText ?? '').slice(0, 1500);
  const tags = ['inbox', 'ingested-doc', category, `knowledge:${knowledgeSubdir}`];

  addObservation(rootDir, {
    role: 'construct',
    category,
    summary,
    content: `source: ${sourcePath}\noutput: ${outputPath}\nknowledge-subdir: ${knowledgeSubdir}\ncharacters: ${characters}\n\n${content}`,
    tags,
    confidence: 0.75,
    source: 'inbox-watcher',
  });
}

// ─── InboxWatcher class ───────────────────────────────────────────────────────

export class InboxWatcher {
  #rootDir;
  #env;
  #cwd;

  /**
   * @param {object} opts
   * @param {string} opts.rootDir - Root dir for observation store + state file
   * @param {object} [opts.env]   - Env override (default: process.env)
   * @param {string} [opts.cwd]   - Working dir for ingest output (default: rootDir)
   */
  constructor({ rootDir, env = process.env, cwd } = {}) {
    this.#rootDir = rootDir;
    this.#env = env;
    this.#cwd = cwd ?? rootDir;
  }

  /**
   * Scan all inbox dirs, ingest new files, record observations.
   * Returns { processed: [...], skipped: number, errors: [...] }
   */
  async poll() {
    const dirs = resolveInboxDirs(this.#rootDir, this.#env);
    const state = readState(this.#rootDir);
    const processed = [];
    const errors = [];
    let skipped = 0;

    for (const dir of dirs) {
      const candidates = scanDir(dir);
      for (const candidate of candidates) {
        const key = candidate.path;

        // Skip if already processed (state key = path + mtime for change detection)
        const stateKey = `${key}:${candidate.mtimeMs}`;
        if (state[key] && state[key].mtimeMs === candidate.mtimeMs) {
          skipped += 1;
          continue;
        }

        try {
          const { category, knowledgeSubdir } = inferFileClassification(candidate.path);
          const result = await ingestDocuments([candidate.path], {
            cwd: this.#cwd,
            target: `knowledge/${knowledgeSubdir}`,
            sync: false,
            env: this.#env,
          });

          const fileResult = result.files?.[0];
          if (fileResult) {
            // Best-effort: read back the extracted text from the written markdown
            let extractedText = '';
            try {
              const md = readFileSync(fileResult.outputPath, 'utf8');
              const contentIdx = md.indexOf('## Extracted Content');
              if (contentIdx !== -1) extractedText = md.slice(contentIdx + 20).trim();
            } catch { /* non-fatal */ }

            recordInboxObservation(this.#rootDir, {
              sourcePath: candidate.path,
              outputPath: fileResult.outputPath,
              characters: fileResult.characters,
              extractedText,
              category,
              knowledgeSubdir,
            });

            state[key] = { mtimeMs: candidate.mtimeMs, processedAt: new Date().toISOString(), outputPath: fileResult.outputPath };
            processed.push({ path: candidate.path, outputPath: fileResult.outputPath, characters: fileResult.characters, knowledgeSubdir });
          }
        } catch (err) {
          errors.push({ path: candidate.path, error: err.message });
        }
      }
    }

    if (processed.length || errors.length) {
      writeState(this.#rootDir, state);
    }

    return { processed, skipped, errors, dirs };
  }

  /**
   * Return the configured inbox directories (creates project inbox if missing).
   */
  dirs() {
    return resolveInboxDirs(this.#rootDir, this.#env);
  }
}
