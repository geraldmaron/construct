#!/usr/bin/env node
/**
 * lib/hooks/read-tracker.mjs — Read tracker hook — tracks file reads for efficiency analysis.
 *
 * Runs as PostToolUse after Read tool calls. Logs each read to ~/.cx/read-log.json including file path, line count, and session timestamp for efficiency reporting.
 */
// PostToolUse(Read) — records file content hash after each Read call
// Powers hash-staleness check in edit-guard.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import { createHash } from 'crypto';
import { join, resolve } from 'path';
import { homedir } from 'os';

const CX_DIR = join(homedir(), '.cx');
const HASH_STORE = join(CX_DIR, 'file-hashes.json');
const EFFICIENCY_STORE = join(CX_DIR, 'session-efficiency.json');
const WARN_FLAGS = join(CX_DIR, 'warn-flags.txt');
const SESSION_IDLE_RESET_MS = 2 * 60 * 60 * 1000;
const REPEATED_READ_WARNING_THRESHOLD = 5;
const LARGE_READ_WARNING_THRESHOLD = 3;
const TOTAL_BYTES_WARNING_THRESHOLD = 750_000;

function loadEfficiencyStats(nowIso) {
  const fresh = {
    sessionStartedAt: nowIso,
    lastUpdatedAt: nowIso,
    readCount: 0,
    uniqueFileCount: 0,
    repeatedReadCount: 0,
    largeReadCount: 0,
    totalBytesRead: 0,
    warnings: {},
    files: {},
  };

  try {
    const existing = JSON.parse(readFileSync(EFFICIENCY_STORE, 'utf8'));
    const lastUpdated = new Date(existing.lastUpdatedAt || 0).getTime();
    if (!lastUpdated || Date.now() - lastUpdated > SESSION_IDLE_RESET_MS) return fresh;
    return { ...fresh, ...existing, warnings: existing.warnings || {}, files: existing.files || {} };
  } catch {
    return fresh;
  }
}

function appendWarning(message) {
  try { appendFileSync(WARN_FLAGS, `${message}\n`); } catch { /* best effort */ }
}

function topRepeatedPath(files) {
  return Object.entries(files || {})
    .map(([filePath, value]) => ({ filePath, count: Number(value?.count || 0) }))
    .filter((entry) => entry.count > 1)
    .sort((a, b) => b.count - a.count || a.filePath.localeCompare(b.filePath))[0];
}

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

if ((input?.tool_name || '') !== 'Read') process.exit(0);

const rawPath = input?.tool_input?.file_path || '';
if (!rawPath) process.exit(0);

const absPath = rawPath.startsWith('/') ? rawPath : resolve(input?.cwd || process.cwd(), rawPath);
if (!existsSync(absPath)) process.exit(0);

try {
  const content = readFileSync(absPath, 'utf8');
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  const nowIso = new Date().toISOString();
  const requestedLimit = Number(input?.tool_input?.limit || 0);
  const effectiveLimit = requestedLimit > 0 ? requestedLimit : 2000;
  const isLargeRead = effectiveLimit > 400;

  mkdirSync(CX_DIR, { recursive: true });
  let store = {};
  try { store = JSON.parse(readFileSync(HASH_STORE, 'utf8')); } catch { /* fresh */ }

  store[absPath] = { hash, ts: nowIso, size: content.length };

  // Prune entries older than 2 hours
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [k, v] of Object.entries(store)) {
    if (new Date(v.ts).getTime() < cutoff) delete store[k];
  }

  writeFileSync(HASH_STORE, JSON.stringify(store, null, 2));

  const stats = loadEfficiencyStats(nowIso);
  const existingFile = stats.files[absPath];
  stats.readCount += 1;
  stats.totalBytesRead += content.length;
  if (isLargeRead) stats.largeReadCount += 1;
  if (existingFile) {
    stats.repeatedReadCount += 1;
  } else {
    stats.uniqueFileCount += 1;
  }
  stats.files[absPath] = {
    count: (existingFile?.count || 0) + 1,
    size: content.length,
    lastReadAt: nowIso,
    lastRequestedLimit: effectiveLimit,
  };

  if (stats.repeatedReadCount >= REPEATED_READ_WARNING_THRESHOLD && !stats.warnings.repeatedReads) {
    const top = topRepeatedPath(stats.files);
    const topNote = top ? ` Top repeat: ${top.filePath} (${top.count}x).` : '';
    appendWarning(`Efficiency: ${stats.repeatedReadCount} repeated reads this session.${topNote} Use rg or construct distill before re-reading more files.`);
    stats.warnings.repeatedReads = nowIso;
  }

  if (stats.largeReadCount >= LARGE_READ_WARNING_THRESHOLD && !stats.warnings.largeReads) {
    appendWarning(`Efficiency: ${stats.largeReadCount} large reads this session — prefer rg/glob plus targeted reads under 400 lines.`);
    stats.warnings.largeReads = nowIso;
  }

  if (stats.totalBytesRead >= TOTAL_BYTES_WARNING_THRESHOLD && !stats.warnings.totalBytes) {
    appendWarning(`Efficiency: ${Math.round(stats.totalBytesRead / 1024)} KB read this session — consider distill/query-focused retrieval or compact context before continuing.`);
    stats.warnings.totalBytes = nowIso;
  }

  stats.lastUpdatedAt = nowIso;

  writeFileSync(EFFICIENCY_STORE, JSON.stringify(stats, null, 2));
} catch { /* best effort */ }

process.exit(0);
