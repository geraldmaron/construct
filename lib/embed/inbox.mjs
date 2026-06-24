/**
 * lib/embed/inbox.mjs — filesystem inbox watcher for the embed daemon.
 *
 * Watches one or more local directories for new ingestable files and
 * processes them into the observation store. Agnostic to content type —
 * handles specs, ADRs, meeting notes, internal docs, research, PDFs,
 * Office files, plain text, code, or any format supported by document-extract.
 *
 * Watch dirs:
 *   1. <rootDir>/inbox/      — the canonical project-root drop zone (always watched)
 *   2. CX_INBOX_DIRS env var + intakePolicy.additionalDirs — opt-in extra paths
 *
 * Atomic handoff (ADR-0045 §C): writers stage a file under `inbox/.staging/`
 * and atomically rename it into `inbox/`. The watcher ignores `.staging/` and
 * dotfiles, and skips any top-level file whose size is still changing between
 * two stats, so a partially-written drop is never consumed mid-write.
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

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { isExtractableDocumentPath, AUDIO_VIDEO_EXTS } from '../document-extract.mjs';
import { ingestDocuments } from '../document-ingest.mjs';
import { addObservation } from '../observation-store.mjs';
import { inferKnowledgeTarget, knowledgeDirForCategory } from '../knowledge/layout.mjs';
import { docLaneDir, suggestDocsLaneForFile } from '../docs-routing.mjs';
import { shouldCreateCx } from '../project-detection.mjs';
import { ensureCxDir } from '../project-init-shared.mjs';
import { prepareIntakeForIngestedFile } from '../intake/prepare.mjs';
import { loadIntakeConfig, INTAKE_DEFAULT_MAX_DEPTH } from '../intake/intake-config.mjs';
import { loadManifest, recordFile, hasFile, sha256Of, MANIFEST_REL_PATH } from '../intake/manifest.mjs';
import { gatherAttribution } from '../intake/attribution.mjs';
import { acquirePollLock, releasePollLock } from '../intake/poll-lock.mjs';

const STATE_FILE = '.cx/runtime/inbox-state.json';
const ROOT_INBOX_SUBDIR = 'inbox';
const STAGING_SUBDIR = '.staging';
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB hard cap
const STALE_STATE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Extraction-warning helpers ───────────────────────────────────────────────

function extractionWarningsLog() {
  return join(homedir(), '.cx', 'intake', 'extraction-warnings.jsonl');
}

function needsAsrDir() {
  return join(homedir(), '.cx', 'intake', 'needs-asr');
}

function writeExtractionWarning({ sourcePath, droppedInfo }) {
  if (!droppedInfo?.length) return;
  const logPath = extractionWarningsLog();
  try {
    mkdirSync(join(homedir(), '.cx', 'intake'), { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), sourcePath, droppedInfo }) + '\n';
    appendFileSync(logPath, line);
  } catch { /* non-fatal */ }
}

function writeAsrPacket({ sourcePath, extension, errorMessage }) {
  try {
    const dir = needsAsrDir();
    mkdirSync(dir, { recursive: true });
    const id = `asr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const packet = { id, ts: new Date().toISOString(), sourcePath, extension, error: errorMessage };
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(packet, null, 2));
    return id;
  } catch { return null; }
}

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

// ─── Stale state pruning ─────────────────────────────────────────────────────

/**
 * Remove state entries for source files absent from disk for more than 7 days.
 * Returns the count of removed entries.
 */
function pruneStaleState(rootDir, state) {
  const cutoffMs = Date.now() - STALE_STATE_AGE_MS;
  let removed = 0;
  for (const key of Object.keys(state)) {
    const entry = state[key];
    if (!existsSync(key) && entry.processedAt) {
      const processedMs = new Date(entry.processedAt).getTime();
      if (processedMs < cutoffMs) {
        delete state[key];
        removed++;
      }
    }
  }
  return removed;
}

// ─── State helpers ────────────────────────────────────────────────────────────

function statePath(rootDir) {
  return join(rootDir, STATE_FILE);
}

function readState(rootDir) {
  const p = statePath(rootDir);
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (err) { process.stderr.write('[inbox.mjs] readState: ' + (err?.message ?? String(err)) + '\n'); return {}; }
}

function writeState(rootDir, state) {
  const p = statePath(rootDir);
  
  // Only create .cx directories if this is an initialized project
  if (shouldCreateCx(rootDir)) {
    ensureCxDir(rootDir);
    mkdirSync(join(rootDir, '.cx', 'runtime'), { recursive: true });
    writeFileSync(p, JSON.stringify(state, null, 2) + '\n');
  }
  // If not an initialized project, don't create .cx - state will be lost
  // but that's okay since we shouldn't be processing files in uninitialized dirs
}

// ─── Directory resolution ─────────────────────────────────────────────────────

/**
 * Resolve inbox watch directories from the persisted intake-config.
 * The canonical <rootDir>/inbox/ is always watched (ADR-0045 §C). `parentDirs`
 * from intake-config plus CX_INBOX_DIRS env var add opt-in extras.
 *
 * The canonical inbox gets a `.staging/` subdir on resolution so writers have
 * a stable place to assemble a file before the atomic rename into `inbox/`.
 */
export function resolveInboxDirs(rootDir, env = process.env) {
  const config = loadIntakeConfig(rootDir, env);
  const dirs = [];

  const rootInbox = join(rootDir, ROOT_INBOX_SUBDIR);
  mkdirSync(rootInbox, { recursive: true });
  mkdirSync(join(rootInbox, STAGING_SUBDIR), { recursive: true });
  dirs.push(rootInbox);

  for (const candidate of config.parentDirs) {
    if (!candidate) continue;
    if (!existsSync(candidate)) continue;
    if (dirs.includes(candidate)) continue;
    dirs.push(candidate);
  }

  return dirs;
}

// ─── File scanning ────────────────────────────────────────────────────────────

// Dotfiles and dot-directories — including the `inbox/.staging/` assembly
// area writers rename out of — are skipped wholesale, so a staged file is
// never visible to the scanner until it lands at a top-level name.

function isStableFile(full) {
  try {
    const a = statSync(full);
    const b = statSync(full);
    return a.size === b.size && a.mtimeMs === b.mtimeMs ? a : null;
  } catch {
    return null;
  }
}

/**
 * Walk `dir` up to `maxDepth` subdirectory levels.
 * maxDepth=0 → only files in `dir` itself (no subdirs).
 * Directories are tracked with their depth so the walk stops at the limit.
 */
function scanDir(dir, maxDepth = INTAKE_DEFAULT_MAX_DEPTH) {
  const results = [];
  const stack = [{ path: dir, depth: 0 }];
  try {
    while (stack.length > 0) {
      const { path: current, depth } = stack.pop();
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          if (depth < maxDepth) stack.push({ path: full, depth: depth + 1 });
          continue;
        }
        if (!entry.isFile()) continue;
        if (!isExtractableDocumentPath(full)) continue;

        // Stability backstop for writers that drop in place instead of staging:
        // a file whose size/mtime is still moving between two stats is mid-write,
        // so leave it for the next poll once it settles.

        const st = isStableFile(full);
        if (!st) continue;
        if (st.size === 0 || st.size > MAX_FILE_SIZE_BYTES) continue;
        results.push({ path: full, size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  } catch (err) { process.stderr.write('[inbox.mjs] scan-dir: ' + (err?.message ?? String(err)) + '\n'); }
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
async function recordInboxObservation(rootDir, { sourcePath, outputPath, characters, extractedText, category, knowledgeSubdir }) {
  const lines = (extractedText ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const firstLine = (lines[0] ?? '').slice(0, 120);
  const filename = sourcePath.split('/').pop();
  const summary = firstLine
    ? `[inbox] ${filename}: ${firstLine}`
    : `[inbox] Ingested document: ${filename}`;
  const content = (extractedText ?? '').slice(0, 1500);
  const tags = ['inbox', 'ingested-doc', category, `knowledge:${knowledgeSubdir}`];

  // Await the write so callers (poll) know ingestion is complete. Fire-and-
  // forget here let the LanceDB write outlive poll() and race the caller's
  // teardown, surfacing as "ENOTEMPTY: directory not empty" on .cx cleanup.
  await addObservation(rootDir, {
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

  // A source already in markdown keeps its name; others gain a .md rendering
  // suffix. Without the guard an intake item named foo.md promotes to foo.md.md.

  const docFileName = /\.md$/i.test(sourceName) ? sourceName : `${sourceName}.md`;
  const targetPath = nextAvailablePath(join(laneDir, docFileName));
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
  #prepareIntakeFn;

  /**
   * @param {object} opts
   * @param {string} opts.rootDir - Root dir for observation store + state file
   * @param {object} [opts.env]   - Env override (default: process.env)
   * @param {string} [opts.cwd]   - Working dir for ingest output (default: rootDir)
   * @param {Function} [opts.prepareIntakeFn] - Override for prepareIntakeForIngestedFile
   *   (test seam): receives the same args; returns null/throws to simulate a failed
   *   packet creation so tests can assert the manifest-gate behavior (construct-k4bg).
   */
  constructor({ rootDir, env = process.env, cwd, prepareIntakeFn } = {}) {
    this.#rootDir = rootDir;
    this.#env = env;
    this.#cwd = cwd ?? rootDir;
    this.#prepareIntakeFn = prepareIntakeFn ?? prepareIntakeForIngestedFile;
  }

  /**
   * Scan all inbox dirs, ingest new files, record observations.
   * Returns { processed: [...], skipped: number, errors: [...] }
   *
   * @param {object} [opts]
   * @param {number} [opts.waitMs] - When >0, block up to this many ms for
   *   the intake poll lock. Default 0 (fail-fast). The CLI sets this when
   *   the operator opts into waiting; the daemon's tick keeps the default
   *   so a stuck poll does not stall the next scheduled iteration.
   * @param {string} [opts.actor] - Stamped onto the lock for diagnostics.
   */
  async poll({ waitMs = 0, actor = 'inbox-watcher' } = {}) {
    let lockHeld = false;
    try {
      await acquirePollLock({
        rootDir: this.#rootDir,
        actor,
        command: 'InboxWatcher.poll',
        waitMs,
      });
      lockHeld = true;
      return await this.#pollLocked();
    } finally {
      if (lockHeld) releasePollLock(this.#rootDir);
    }
  }

  async #pollLocked() {
    const config = loadIntakeConfig(this.#rootDir, this.#env);
    const dirs = resolveInboxDirs(this.#rootDir, this.#env);
    const state = readState(this.#rootDir);
    const processed = [];
    const errors = [];
    let skipped = 0;

    // Capability detection: SHA-256 dedup is enabled when the project's
    // intake manifest exists (init scaffolds it for the archetype). Hashing
    // is only paid when the manifest is in use, so non-archetype projects
    // keep the original fast path.

    const manifestPath = join(this.#rootDir, MANIFEST_REL_PATH);
    const manifestEnabled = existsSync(manifestPath);
    const attribution = manifestEnabled ? gatherAttribution({ cwd: this.#rootDir }) : null;

    for (const dir of dirs) {
      const candidates = scanDir(dir, config.maxDepth);
      for (const candidate of candidates) {
        const key = candidate.path;

        // Skip if already processed (state key = path + mtime for change detection)
        const stateKey = `${key}:${candidate.mtimeMs}`;
        if (state[key] && state[key].mtimeMs === candidate.mtimeMs) {
          skipped += 1;
          continue;
        }

        // Manifest dedup: a file with identical content under any path is
        // a duplicate. Catches renames, copies, and re-drops the state
        // check misses. Skipped here without consuming the ingest budget.

        let candidateSha = null;
        if (manifestEnabled) {
          try {
            const bytes = readFileSync(candidate.path);
            candidateSha = sha256Of(bytes);
            if (hasFile(this.#rootDir, candidateSha)) {
              skipped += 1;
              state[key] = { mtimeMs: candidate.mtimeMs, processedAt: new Date().toISOString(), dedupHash: candidateSha };
              continue;
            }
          } catch (err) {
            if (this.#env.CONSTRUCT_DEBUG_INTAKE === '1') {
              process.stderr.write(`[inbox] sha256 hashing failed for ${candidate.path}: ${err.message}\n`);
            }
          }
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
            } catch (err) { process.stderr.write('[inbox.mjs] read-extracted-text: ' + (err?.message ?? String(err)) + '\n'); }

            // Write extraction warnings JSONL for any dropped structured content.
            const droppedInfo = fileResult.droppedInfo ?? [];
            writeExtractionWarning({ sourcePath: candidate.path, droppedInfo });

            await recordInboxObservation(this.#rootDir, {
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

            // Queue an intake packet so the agent can triage the new signal
            // against the existing corpus. Failure here is non-fatal — ingest
            // already succeeded; the queue is a best-effort handoff, not the
            // ingestion's source of truth.

            let intakeId = null;
            let intakeFailed = false;
            try {
              const intakeResult = await this.#prepareIntakeFn({
                rootDir: this.#rootDir,
                ingestedFile: {
                  sourcePath: candidate.path,
                  outputPath: fileResult.outputPath,
                  characters: fileResult.characters,
                  knowledgeSubdir,
                  droppedInfo,
                },
                env: this.#env,
              });
              intakeId = intakeResult?.id || null;
              if (!intakeId) intakeFailed = true;
            } catch (err) {
              intakeFailed = true;
              if (this.#env.CONSTRUCT_DEBUG_INTAKE === '1') {
                process.stderr.write(`[inbox] intake queue write failed for ${candidate.path}: ${err.message}\n`);
              }
            }

            state[key] = { mtimeMs: candidate.mtimeMs, processedAt: new Date().toISOString(), outputPath: fileResult.outputPath };

            // The dedup manifest entry is the signal that `construct intake
            // process` uses to skip already-handled files. Recording it when
            // packet creation failed strands the file: explicit `intake process`
            // reports "skipped (unchanged)" while `intake list` is empty, with
            // no path back. Record only on a successful intake id so a failed
            // auto-ingest stays retriable via the explicit path (construct-k4bg).

            if (manifestEnabled && candidateSha && intakeId && !intakeFailed) {
              try {
                recordFile(this.#rootDir, candidateSha, {
                  sourcePath: candidate.path,
                  intakeId,
                  createdBy: attribution?.createdBy ?? null,
                  createdByAgent: attribution?.createdByAgent ?? null,
                });
              } catch (err) {
                if (this.#env.CONSTRUCT_DEBUG_INTAKE === '1') {
                  process.stderr.write(`[inbox] manifest record failed for ${candidate.path}: ${err.message}\n`);
                }
              }
            } else if (manifestEnabled && intakeFailed) {
              process.stderr.write(`[inbox] ${candidate.path}: ingest succeeded but intake-packet creation failed; rerun \`construct intake process\` to retry.\n`);
            }

            processed.push({ path: candidate.path, outputPath: fileResult.outputPath, docsPath, characters: fileResult.characters, knowledgeSubdir, intakeId, dedupHash: candidateSha });
          }
        } catch (err) {
          // Audio/video files cannot be text-extracted without ASR. Route to
          // the needs-asr queue so the signal is preserved for later processing.
          if (err.code === 'ASR_REQUIRED') {
            const asrId = writeAsrPacket({ sourcePath: candidate.path, extension: err.extension, errorMessage: err.message });
            state[key] = { mtimeMs: candidate.mtimeMs, processedAt: new Date().toISOString(), needsAsr: true, asrId };
            processed.push({ path: candidate.path, needsAsr: true, asrId });
          } else {
            errors.push({ path: candidate.path, error: err.message });
          }
        }
      }
    }

    // Prune stale state entries: remove entries for source files absent from disk
    // for more than 7 days (covers moved/renamed files that linger in state).
    const staleRemoved = pruneStaleState(this.#rootDir, state);
    if (staleRemoved > 0) {
      process.stderr.write(`[inbox] pruned ${staleRemoved} stale state entries\n`);
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
