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
 *   3. <rootDir>/docs/intake/ — project intake drop zone when docs init is used
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
import { docLaneDir, suggestDocsLaneForFile } from '../docs-routing.mjs';

const STATE_FILE = '.cx/runtime/inbox-state.json';
const DEFAULT_INBOX_SUBDIR = '.cx/inbox';
const DOCS_INTAKE_SUBDIR = 'docs/intake';
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB hard cap

function nextAvailablePath(targetPath) {
  if (!existsSync(targetPath)) return targetPath;
  const dot = targetPath.lastIndexOf('.');
  const base = dot === -1 ? targetPath : targetPath.slice(0, dot);
  const ext = dot === -1 ? '' : targetPath.slice(dot);
  let index = 2;
  while (true) {
    const candidate = `${base}-${index}${ext}`;
    if (!existsSync(candidate)) return candidate;
    index += 1;
  }
}

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
 * Includes <rootDir>/docs/intake/ when it exists so docs-init intake can act as a drop surface.
 * CX_INBOX_DIRS adds extra absolute paths from the local filesystem.
 */
export function resolveInboxDirs(rootDir, env = process.env) {
  const dirs = [];

  // Always include the per-project inbox dir
  const projectInbox = join(rootDir, DEFAULT_INBOX_SUBDIR);
  mkdirSync(projectInbox, { recursive: true });
  dirs.push(projectInbox);

  const docsIntake = join(rootDir, DOCS_INTAKE_SUBDIR);
  if (existsSync(docsIntake)) dirs.push(docsIntake);

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
  const stack = [dir];
  try {
    while (stack.length > 0) {
      const current = stack.pop();
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!isExtractableDocumentPath(full)) continue;
        try {
          const st = statSync(full);
          if (st.size === 0 || st.size > MAX_FILE_SIZE_BYTES) continue;
          results.push({ path: full, size: st.size, mtimeMs: st.mtimeMs });
        } catch { /* unreadable */ }
      }
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

function maybePromoteToDocs(rootDir, { sourcePath, extractedText }) {
  const suggestedLane = suggestDocsLaneForFile(sourcePath, extractedText);
  if (!suggestedLane || suggestedLane === 'intake') return null;

  const laneDir = join(rootDir, 'docs', docLaneDir(suggestedLane));
  if (!existsSync(laneDir)) return null;

  const sourceName = sourcePath.split('/').pop() ?? 'intake-doc';
  const targetPath = nextAvailablePath(join(laneDir, `${sourceName}.md`));
  const title = sourceName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Promoted intake document';
  const markdown = [
    '# ' + title,
    '',
    '> Promoted from intake for review and incorporation into this docs lane.',
    '',
    `- Source: \`${sourcePath}\``,
    `- Suggested lane: \`${suggestedLane}\``,
    '',
    '## Extracted Content',
    '',
    extractedText || '',
    '',
  ].join('\n');

  writeFileSync(targetPath, markdown);
  return targetPath;
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

            const docsPath = maybePromoteToDocs(this.#rootDir, {
              sourcePath: candidate.path,
              extractedText,
            });

            state[key] = { mtimeMs: candidate.mtimeMs, processedAt: new Date().toISOString(), outputPath: fileResult.outputPath };
            processed.push({ path: candidate.path, outputPath: fileResult.outputPath, docsPath, characters: fileResult.characters, knowledgeSubdir });
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
