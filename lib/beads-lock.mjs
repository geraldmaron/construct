/**
 * lib/beads-lock.mjs — File‑based lock manager for the embedded Dolt database.
 *
 * Manages exclusive access to `.beads/embeddeddolt/.lock-meta.json` with
 * stale-detection, queue visibility, and human‑readable status.
 *
 * Lock format:
 *   {
 *     pid: number,
 *     actor: string,
 *     command: string,           // What they're doing (e.g., "bd list")
 *     timestamp: string,         // ISO 8601
 *     startedAt: string,         // When lock was acquired
 *     timeoutAt?: string         // When lock will auto‑expire (optional)
 *   }
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getBeadsRoot(cwd = process.cwd()) {
  const candidate = path.join(cwd, '.beads');
  if (fs.existsSync(candidate)) return candidate;
  const parent = path.dirname(cwd);
  if (parent !== cwd) return getBeadsRoot(parent);
  return null;
}

function lockMetaPath(cwd = process.cwd()) {
  const beadsRoot = getBeadsRoot(cwd);
  if (!beadsRoot) return null;
  return path.join(beadsRoot, 'embeddeddolt', '.lock-meta.json');
}

function queuePath(cwd = process.cwd()) {
  const beadsRoot = getBeadsRoot(cwd);
  if (!beadsRoot) return null;
  return path.join(beadsRoot, 'queue.jsonl');
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function processExists(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function nowISO() {
  return new Date().toISOString();
}

function afterDelay(seconds) {
  const d = new Date(Date.now() + seconds * 1000);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Core lock management
// ---------------------------------------------------------------------------

/**
 * Read the current lock without any cleanup.
 */
export function readLock(cwd = process.cwd()) {
  const p = lockMetaPath(cwd);
  if (!p || !fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const lock = JSON.parse(raw);
    if (typeof lock !== 'object' || lock === null) return null;
    return lock;
  } catch {
    return null;
  }
}

/**
 * Write a new lock.
 */
function writeLock(lock, cwd = process.cwd()) {
  const p = lockMetaPath(cwd);
  if (!p) throw new Error('No .beads directory found');
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  const content = JSON.stringify(lock, null, 2);
  fs.writeFileSync(p, content, 'utf8');
}

export function writeLockSilently(lock, cwd = process.cwd()) {
  writeLock(lock, cwd);
}

/**
 * Remove the lock file.
 */
function removeLock(cwd = process.cwd()) {
  const p = lockMetaPath(cwd);
  if (p && fs.existsSync(p)) fs.rmSync(p, { force: true });
}

export function removeLockSilently(cwd = process.cwd()) {
  removeLock(cwd);
}

/**
 * Check if a lock is stale (process dead or timeout reached).
 */
export function isLockStale(lock, cwd = process.cwd()) {
  if (!lock) return false;
  if (lock.pid && !processExists(lock.pid)) return true;
  if (lock.timeoutAt && new Date(lock.timeoutAt) < new Date()) return true;
  return false;
}

/**
 * Acquire the lock, waiting up to `timeoutMs` milliseconds.
 * Returns the lock object on success, null on timeout.
 */
export async function acquireLock({ actor = 'unknown', command = '', timeoutSeconds = 30, cwd = process.cwd() } = {}) {
  const start = Date.now();
  const timeoutMs = timeoutSeconds * 1000;

  while (Date.now() - start < timeoutMs) {
    cleanupStaleLock({ cwd });

    const existing = readLock(cwd);
    if (!existing) {
      const lock = {
        pid: process.pid,
        actor,
        command,
        timestamp: nowISO(),
        startedAt: nowISO(),
        timeoutAt: timeoutSeconds > 0 ? afterDelay(timeoutSeconds) : undefined,
      };
      writeLock(lock, cwd);
      return lock;
    }

    // Wait 100ms and retry
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return null;
}

/**
 * Release the lock if it belongs to the current process.
 */
export function releaseLock({ cwd = process.cwd() } = {}) {
  const lock = readLock(cwd);
  if (lock && lock.pid === process.pid) {
    removeLock(cwd);
    return true;
  }
  return false;
}

/**
 * Clean up a stale lock and return whether cleanup occurred.
 */
export function cleanupStaleLock({ cwd = process.cwd() } = {}) {
  const lock = readLock(cwd);
  if (isLockStale(lock, cwd)) {
    removeLock(cwd);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Queue management (FIFO)
// ---------------------------------------------------------------------------

function ensureQueueFile(p) {
  if (!fs.existsSync(p)) fs.writeFileSync(p, '', 'utf8');
}

/**
 * Add a request to the queue.
 */
export function enqueueRequest({ actor, command, args = [], cwd = process.cwd() } = {}) {
  const p = queuePath(cwd);
  if (!p) return null;
  ensureQueueFile(p);
  const entry = {
    pid: process.pid,
    actor,
    args,
    command,
    timestamp: nowISO(),
  };
  fs.appendFileSync(p, JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

/**
 * Read all pending requests (may include stale entries if processes died).
 */
export function readQueue({ cwd = process.cwd() } = {}) {
  const p = queuePath(cwd);
  if (!p || !fs.existsSync(p)) return [];
  const content = fs.readFileSync(p, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);
  return lines.map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

/**
 * Remove a request from the queue (e.g., claim it).
 */
export function removeFromQueue(pidOrTimestamp, { cwd = process.cwd() } = {}) {
  const p = queuePath(cwd);
  if (!p || !fs.existsSync(p)) return false;
  const all = readQueue({ cwd });
  const filtered = all.filter(
    (entry) => entry.pid !== pidOrTimestamp && entry.timestamp !== pidOrTimestamp
  );
  if (filtered.length === all.length) return false;
  fs.writeFileSync(p, filtered.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  return true;
}

/**
 * Remove all stale queue entries where the process no longer exists.
 */
export function cleanupStaleQueue({ cwd = process.cwd() } = {}) {
  const before = readQueue({ cwd });
  const after = before.filter((entry) => processExists(entry.pid));
  if (after.length === before.length) return 0;
  const p = queuePath(cwd);
  if (p) {
    fs.writeFileSync(p, after.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  }
  return before.length - after.length;
}

// ---------------------------------------------------------------------------
// Status reporting
// ---------------------------------------------------------------------------

/**
 * Comprehensive lock/queue status.
 * Used by `construct beads status`
 */
export function getLockStatus({ cwd = process.cwd() } = {}) {
  const lock = readLock(cwd);
  cleanupStaleLock({ cwd });
  const queue = readQueue({ cwd });
  cleanupStaleQueue({ cwd });

  const status = {
    cwd: path.resolve(cwd),
    locked: !!lock,
    beadsRoot: getBeadsRoot(cwd),
    lockMetaPath: lockMetaPath(cwd),
  };

  if (lock) {
    status.lock = {
      pid: lock.pid,
      actor: lock.actor,
      command: lock.command,
      startedAt: lock.startedAt,
      timestamp: lock.timestamp,
      alive: processExists(lock.pid),
      humanReadable: `${lock.actor} is running "${lock.command}" (pid ${lock.pid}, started ${lock.startedAt})`,
    };
  }

  if (queue.length) {
    status.queueCount = queue.length;
    status.queue = queue.map((entry) => ({
      pid: entry.pid,
      actor: entry.actor,
      command: entry.command || (entry.args && entry.args.join(' ')),
      timestamp: entry.timestamp,
      alive: processExists(entry.pid),
      waitingFor: `${entry.actor} wants to run: ${entry.args?.join(' ') || entry.command}`,
    }));
  }

  return status;
}

/**
 * Human‑readable status string.
 */
export function formatStatus(status) {
  if (!status.locked) return '🔓 No lock held';
  const l = status.lock;
  return `🔒 Lock held by ${l.actor} (pid ${l.pid})
    → ${l.command}
    → Started: ${l.startedAt}${l.alive ? '' : ' ⚠️ process appears dead'}${status.queueCount ? `\n   └─ ${status.queueCount} waiting in queue` : ''}`;
}
