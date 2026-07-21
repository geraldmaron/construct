/**
 * lib/hooks/read-tracker-store.mjs — batched persistence for read-efficiency tracking.
 *
 * The Read hook runs in a fresh process for every file read. Persisting the
 * full session-efficiency store on every invocation is correct but noisy and
 * expensive. This module appends compact JSONL deltas per read, then folds
 * them into the durable session summary when the delta log is flushed.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { doctorRoot } from './config/xdg.mjs';

const SESSION_IDLE_RESET_MS = 2 * 60 * 60 * 1000;
const REPEATED_READ_WARNING_THRESHOLD = 5;
const REPEATED_READ_TIER2_THRESHOLD = 8;
const LARGE_READ_WARNING_THRESHOLD = 3;
const TOTAL_BYTES_WARNING_THRESHOLD = 750_000;
const FILES_LRU_CAP = 200;
const EFFICIENCY_LARGE_READ_LIMIT = 400;

export function readTrackerPaths(env = process.env) {
  const home = env.CONSTRUCT_HOME_OVERRIDE || env.HOME || homedir();
  const constructDir = doctorRoot(home);
  return {
    constructDir,
    efficiencyStore: join(constructDir, 'session-efficiency.json'),
    deltaLog: join(constructDir, 'session-efficiency.reads.jsonl'),
    warnFlags: join(constructDir, 'warn-flags.txt'),
  };
}

export function freshEfficiencyStats(nowIso) {
  return {
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
}

export function loadEfficiencyStats(nowIso, env = process.env) {
  const { efficiencyStore } = readTrackerPaths(env);
  const fresh = freshEfficiencyStats(nowIso);
  try {
    const existing = JSON.parse(readFileSync(efficiencyStore, 'utf8'));
    const lastUpdated = new Date(existing.lastUpdatedAt || 0).getTime();
    if (!lastUpdated || Date.now() - lastUpdated > SESSION_IDLE_RESET_MS) return fresh;
    return { ...fresh, ...existing, warnings: existing.warnings || {}, files: existing.files || {} };
  } catch {
    return fresh;
  }
}

function appendWarning(message, env = process.env) {
  try {
    const { warnFlags } = readTrackerPaths(env);
    appendFileSync(warnFlags, `${message}\n`);
  } catch { /* best effort */ }
}

function topRepeatedPath(files) {
  return Object.entries(files || {})
    .map(([filePath, value]) => ({ filePath, count: Number(value?.count || 0) }))
    .filter((entry) => entry.count > 1)
    .sort((a, b) => b.count - a.count || a.filePath.localeCompare(b.filePath))[0];
}

export function applyReadDelta(stats, delta, env = process.env) {
  const existingFile = stats.files[delta.path];
  const isLargeRead = Number(delta.limit || 0) > EFFICIENCY_LARGE_READ_LIMIT;

  stats.readCount += 1;
  stats.totalBytesRead += Number(delta.size || 0);
  if (isLargeRead) stats.largeReadCount += 1;
  if (existingFile) stats.repeatedReadCount += 1;
  else stats.uniqueFileCount += 1;

  stats.files[delta.path] = {
    count: Number(existingFile?.count || 0) + 1,
    size: Number(delta.size || 0),
    lastReadAt: delta.ts,
    lastRequestedLimit: Number(delta.limit || 0),
  };

  const fileEntries = Object.entries(stats.files);
  if (fileEntries.length > FILES_LRU_CAP) {
    fileEntries.sort((a, b) => (a[1]?.lastReadAt || '').localeCompare(b[1]?.lastReadAt || ''));
    const drop = fileEntries.length - FILES_LRU_CAP;
    for (let i = 0; i < drop; i++) delete stats.files[fileEntries[i][0]];
  }

  if (stats.repeatedReadCount >= REPEATED_READ_WARNING_THRESHOLD && !stats.warnings.repeatedReads) {
    const top = topRepeatedPath(stats.files);
    const topNote = top ? ` Top repeat: ${top.filePath} (${top.count}x).` : '';
    appendWarning(`Efficiency: ${stats.repeatedReadCount} repeated reads this session.${topNote} Use rg or construct distill before re-reading more files.`, env);
    stats.warnings.repeatedReads = delta.ts;
    if (stats.repeatedReadCount >= REPEATED_READ_TIER2_THRESHOLD && !stats.warnings.repeatedReadsTier2) {
      appendWarning(`Efficiency: ${stats.repeatedReadCount} repeated reads this session — consider using construct distill or rg before re-reading entire files.`, env);
      stats.warnings.repeatedReadsTier2 = delta.ts;
    }
  }

  if (stats.largeReadCount >= LARGE_READ_WARNING_THRESHOLD && !stats.warnings.largeReads) {
    appendWarning(`Efficiency: ${stats.largeReadCount} large reads this session — prefer rg/glob plus targeted reads under 400 lines.`, env);
    stats.warnings.largeReads = delta.ts;
  }

  if (stats.totalBytesRead >= TOTAL_BYTES_WARNING_THRESHOLD && !stats.warnings.totalBytes) {
    appendWarning(`Efficiency: ${Math.round(stats.totalBytesRead / 1024)} KB read this session — consider distill/query-focused retrieval or compact context before continuing.`, env);
    stats.warnings.totalBytes = delta.ts;
  }

  stats.lastUpdatedAt = delta.ts;
  return stats;
}

export function recordReadDelta(delta, env = process.env) {
  const { constructDir, deltaLog } = readTrackerPaths(env);
  mkdirSync(constructDir, { recursive: true });
  appendFileSync(deltaLog, `${JSON.stringify(delta)}\n`, 'utf8');
}

export function flushReadTrackerDeltas({ nowIso = new Date().toISOString(), env = process.env } = {}) {
  const { constructDir, deltaLog, efficiencyStore } = readTrackerPaths(env);
  mkdirSync(constructDir, { recursive: true });
  const stats = loadEfficiencyStats(nowIso, env);
  if (!existsSync(deltaLog)) return stats;

  const lines = readFileSync(deltaLog, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    try {
      const delta = JSON.parse(line);
      applyReadDelta(stats, delta, env);
    } catch { /* best effort */ }
  }

  writeFileSync(efficiencyStore, `${JSON.stringify(stats, null, 2)}\n`);
  rmSync(deltaLog, { force: true });
  return stats;
}
