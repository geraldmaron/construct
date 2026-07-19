/**
 * lib/maintenance/cleanup.mjs — Construct's self-maintenance primitives.
 *
 * Every artifact Construct writes has a lifecycle. This module collects the
 * primitives that enforce that lifecycle: rotate oversized logs, prune
 * rotated segments, age-out cache directories. Each primitive is pure and
 * returns a structured summary; runFullCleanup orchestrates them with sane
 * defaults.
 *
 * Triggered from two entry points:
 *   - `construct cleanup`            — manual sweep, optionally --dry-run
 *   - bin/construct startup check    — automatic when the installed version
 *                                       differs from the XDG state-dir
 *                                       .cleanup-stamp, so an upgrade reclaims
 *                                       disk without
 *                                       requiring a manual command.
 *
 * Scope is deliberately narrow: only artifacts whose retention is owned by
 * the runtime (logs, caches, rotated segments). Knowledge stores
 * (.construct/observations/, .construct/handoffs/, .construct/intake/) require explicit retention
 * policy and are left for a follow-up after policy is agreed.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { stateDir, cacheDir } from '../config/xdg.mjs';
import { doctorRoot } from '../config/xdg.mjs';

const HARD_BUDGET_MS = 5000;

// Size caps in bytes. Each entry: [filename relative to ~/.construct/, maxBytes].
// Files that exceed maxBytes are truncated (head-preserving rotation is not
// useful for append-only event logs — the most-recent events are what matter,
// not the oldest; tail-preserving truncation keeps the last N% by recopying).
const JSONL_LOG_CAPS_BYTES = {
  'audit.jsonl': 25 * 1024 * 1024,
  'contract-violations.jsonl': 25 * 1024 * 1024,
  'doctor-log.jsonl': 25 * 1024 * 1024,
  'role-pending.jsonl': 5 * 1024 * 1024,
  'role-events.jsonl': 25 * 1024 * 1024,
};

const EMBED_LOG_DEFAULT_MAX_MB = 50;
const EMBED_LOG_DEFAULT_KEEP = 3;
const EMBED_LOG_HARD_CAP_MAX_MB = 500;
const EMBED_LOG_HARD_CAP_KEEP = 20;

function fileSizeOrZero(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

function rmSafe(p, dryRun, recursive = false) {
  if (dryRun) return;
  try { fs.rmSync(p, { force: true, recursive }); } catch (err) {
    process.stderr.write(`[cleanup] failed to remove ${p}: ${err.message}\n`);
  }
}

/**
 * Tail-preserving truncate: keeps the last `keepBytes` of `file`, drops the
 * rest. Used for append-only event logs where recent events are valuable but
 * historical bloat is not.
 */
function tailTruncate(file, keepBytes, dryRun) {
  if (dryRun) return;
  let stat;
  try { stat = fs.statSync(file); } catch { return; }
  if (stat.size <= keepBytes) return;
  const start = stat.size - keepBytes;
  const buf = Buffer.alloc(keepBytes);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, keepBytes, start); } finally { fs.closeSync(fd); }
  // Find the first newline so we don't start mid-record.
  const nl = buf.indexOf(0x0a);
  const payload = nl >= 0 && nl < buf.length - 1 ? buf.subarray(nl + 1) : buf;
  fs.writeFileSync(file, payload);
}

function rotationConfig(env = process.env) {
  const maxMbRaw = Number.parseInt(env.CONSTRUCT_EMBED_LOG_MAX_MB ?? '', 10);
  const keepRaw = Number.parseInt(env.CONSTRUCT_EMBED_LOG_KEEP ?? '', 10);
  const maxMb = Number.isFinite(maxMbRaw) && maxMbRaw > 0 ? Math.min(maxMbRaw, EMBED_LOG_HARD_CAP_MAX_MB) : EMBED_LOG_DEFAULT_MAX_MB;
  const keep = Number.isFinite(keepRaw) && keepRaw >= 0 ? Math.min(keepRaw, EMBED_LOG_HARD_CAP_KEEP) : EMBED_LOG_DEFAULT_KEEP;
  return { maxBytes: maxMb * 1024 * 1024, keep };
}

/**
 * Walk the embed log + every rotated segment (.1, .2, ...) and drop the ones
 * that exceed the per-segment cap OR sit beyond the keep count.
 *
 * Unlike rotateEmbedLogIfNeeded in lib/embed/cli.mjs (which is called at
 * daemon spawn time and only rotates the live log), this is the post-upgrade
 * cleanup: it handles the case where an existing install has segments that
 * were oversized before the cap existed.
 */
export function cleanupEmbedLog({ homeDir = os.homedir(), env = process.env, dryRun = false } = {}) {
  const dir = path.join(doctorRoot(homeDir), 'runtime');
  const baseLog = path.join(dir, 'embed-daemon.log');
  const { maxBytes, keep } = rotationConfig(env);

  const summary = { removed: [], truncated: [], freedBytes: 0, baseLog };

  // Every existing segment (.log, .log.1, .log.2, ...)
  if (!fs.existsSync(dir)) return summary;
  const entries = fs.readdirSync(dir).filter(n => n === 'embed-daemon.log' || n.startsWith('embed-daemon.log.'));

  for (const name of entries) {
    const full = path.join(dir, name);
    const size = fileSizeOrZero(full);

    // Drop segments beyond the keep horizon entirely.
    const dotMatch = name.match(/^embed-daemon\.log\.(\d+)$/);
    if (dotMatch && Number.parseInt(dotMatch[1], 10) > keep) {
      summary.removed.push({ path: full, size });
      summary.freedBytes += size;
      rmSafe(full, dryRun);
      continue;
    }

    // The live log: if oversized, truncate to 0 (it will rotate cleanly on next
    // daemon spawn via rotateEmbedLogIfNeeded). Truncating in place keeps any
    // open daemon FDs valid (writes resume at byte 0 on next O_APPEND write).
    if (name === 'embed-daemon.log' && size > maxBytes) {
      summary.truncated.push({ path: full, sizeWas: size });
      summary.freedBytes += size;
      if (!dryRun) {
        try {
          fs.truncateSync(full, 0);
        } catch (err) {
          process.stderr.write(`[cleanup] failed to truncate ${full}: ${err.message}\n`);
        }
      }
      continue;
    }

    // Rotated segments that are individually oversized: drop them. They are
    // archived noise; keeping them around defeats the cap.
    if (dotMatch && size > maxBytes) {
      summary.removed.push({ path: full, size });
      summary.freedBytes += size;
      rmSafe(full, dryRun);
    }
  }

  return summary;
}

/**
 * Apply per-file size caps to the user-level JSONL event logs at ~/.construct/.
 * Truncates oldest events rather than removing the whole file so the most
 * recent records survive.
 */
export function cleanupJsonlLogs({ homeDir = os.homedir(), dryRun = false } = {}) {
  const dir = doctorRoot(homeDir);
  const summary = { truncated: [], freedBytes: 0 };
  if (!fs.existsSync(dir)) return summary;

  for (const [name, capBytes] of Object.entries(JSONL_LOG_CAPS_BYTES)) {
    const file = path.join(dir, name);
    const size = fileSizeOrZero(file);
    if (size <= capBytes) continue;
    // Retain the most recent half-cap so headroom exists before next truncate.
    const keepBytes = Math.floor(capBytes / 2);
    summary.truncated.push({ path: file, sizeWas: size, sizeNow: keepBytes });
    summary.freedBytes += size - keepBytes;
    tailTruncate(file, keepBytes, dryRun);
  }

  return summary;
}

/**
 * Age out XDG cache-dir entries older than `maxAgeDays`. Cache hits are
 * idempotent and re-fetched on demand, so pruning is safe.
 */
export function cleanupCacheDir({ homeDir = os.homedir(), maxAgeDays = 30, dryRun = false } = {}) {
  const dir = cacheDir(homeDir);
  const summary = { removed: [], freedBytes: 0 };
  if (!fs.existsSync(dir)) return summary;

  const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
  const walk = (current) => {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.mtimeMs < cutoff) {
        summary.removed.push({ path: full, size: stat.size });
        summary.freedBytes += stat.size;
        rmSafe(full, dryRun);
      }
    }
  };
  walk(dir);
  return summary;
}

/**
 * Remove only machine artifacts owned by pre-2.0 Construct. The current
 * ~/.construct config/runtime roots are intentionally never traversed here.
 * Backup names are restricted to Construct's own generated naming convention.
 */
export function cleanupLegacyConstructArtifacts({ homeDir = os.homedir(), dryRun = false } = {}) {
  const state = stateDir(homeDir);
  const targets = [
    path.join(homeDir, '.cx'),
    path.join(state, '.cx'),
    path.join(state, '.construct'),
    path.join(state, 'bash-logs'),
  ];
  try {
    for (const name of fs.readdirSync(homeDir)) {
      if (/^\.construct-(?:full|projects(?:-testleak)?)-backup-.*\.tar\.gz$/i.test(name)) {
        targets.push(path.join(homeDir, name));
      }
    }
  } catch { /* home may be unavailable in a partial install */ }

  const removed = [];
  let freedBytes = 0;
  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    let size = 0;
    try {
      const stat = fs.statSync(target);
      size = stat.isFile() ? stat.size : 0;
    } catch { /* best effort */ }
    removed.push({ path: target, size });
    freedBytes += size;
    rmSafe(target, dryRun, true);
  }
  return { removed, freedBytes };
}

/**
 * Orchestrator. Runs each primitive under a hard time budget and returns an
 * aggregated summary. Individual failures are non-fatal: a primitive that
 * throws is recorded as an error in the summary but does not block the rest.
 */
export function runFullCleanup({ homeDir = os.homedir(), env = process.env, dryRun = false } = {}) {
  const startedAt = Date.now();
  const summary = {
    dryRun,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: 0,
    freedBytes: 0,
    embedLog: null,
    jsonlLogs: null,
    cacheDir: null,
    errors: [],
  };

  const safelyRun = (label, fn) => {
    if (Date.now() - startedAt > HARD_BUDGET_MS) {
      summary.errors.push({ step: label, error: 'time budget exceeded; skipped' });
      return null;
    }
    try { return fn(); }
    catch (err) { summary.errors.push({ step: label, error: err.message }); return null; }
  };

  summary.embedLog = safelyRun('embedLog', () => cleanupEmbedLog({ homeDir, env, dryRun }));
  summary.jsonlLogs = safelyRun('jsonlLogs', () => cleanupJsonlLogs({ homeDir, dryRun }));
  summary.cacheDir = safelyRun('cacheDir', () => cleanupCacheDir({ homeDir, dryRun }));
  summary.legacyConstruct = safelyRun('legacyConstruct', () => cleanupLegacyConstructArtifacts({ homeDir, dryRun }));

  for (const part of [summary.embedLog, summary.jsonlLogs, summary.cacheDir, summary.legacyConstruct]) {
    if (part?.freedBytes) summary.freedBytes += part.freedBytes;
  }
  summary.durationMs = Date.now() - startedAt;
  return summary;
}

/**
 * Format bytes for one-line operator output. 1234567 → "1.2 MB".
 */
export function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit += 1; }
  return `${n.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

// ---------------------------------------------------------------------------
// Version stamp — drives automatic cleanup on upgrade.
//
// The .cleanup-stamp in the XDG state dir records the last version that ran
// cleanup. On every CLI invocation, bin/construct compares the current package
// version to the stamp. A mismatch triggers a single cleanup pass and
// writes the new version into the stamp. The first ever invocation also
// triggers cleanup (no stamp present) — this is what unblocks existing
// installs that already have 34 GB logs sitting around.
// ---------------------------------------------------------------------------

const STAMP_FILENAME = '.cleanup-stamp';

export function stampPath(homeDir = os.homedir()) {
  return path.join(stateDir(homeDir), STAMP_FILENAME);
}

export function readVersionStamp({ homeDir = os.homedir() } = {}) {
  const p = stampPath(homeDir);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

export function writeVersionStamp({ homeDir = os.homedir(), version, summary } = {}) {
  const p = stampPath(homeDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const payload = {
    version,
    ranAt: new Date().toISOString(),
    freedBytes: summary?.freedBytes ?? 0,
    durationMs: summary?.durationMs ?? 0,
  };
  fs.writeFileSync(p, JSON.stringify(payload, null, 2));
}

/**
 * Run cleanup if and only if the installed version differs from the stamp.
 * Returns { ran: bool, reason, summary?, previousVersion? }.
 *
 * Designed to be called at CLI startup. Never throws — cleanup failures are
 * surfaced via the returned summary and never block the actual command.
 */
export function maybeRunCleanupOnUpgrade({
  homeDir = os.homedir(),
  env = process.env,
  currentVersion,
  force = false,
} = {}) {
  if (env.CONSTRUCT_DISABLE_AUTO_CLEANUP === '1') {
    return { ran: false, reason: 'disabled via CONSTRUCT_DISABLE_AUTO_CLEANUP' };
  }
  const stamp = readVersionStamp({ homeDir });
  if (!force && stamp && stamp.version === currentVersion) {
    return { ran: false, reason: 'version matches stamp' };
  }
  let summary;
  try { summary = runFullCleanup({ homeDir, env, dryRun: false }); }
  catch (err) { return { ran: false, reason: `cleanup threw: ${err.message}` }; }
  try { writeVersionStamp({ homeDir, version: currentVersion, summary }); }
  catch (err) { /* stamp write failure is non-fatal */ void err; }
  return {
    ran: true,
    reason: stamp ? 'version changed' : 'first run',
    previousVersion: stamp?.version ?? null,
    summary,
  };
}
