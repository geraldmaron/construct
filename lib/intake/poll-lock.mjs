/**
 * lib/intake/poll-lock.mjs — pid-stamped file lock around InboxWatcher.poll().
 *
 * Two pollers (the embed daemon and a manual `construct intake process`)
 * share the same state file + manifest. Without serialization, both can
 * decide a freshly-dropped file is unprocessed in the window between
 * "read state" and "write state," producing two intake packets for one
 * source. The lock makes one poll iteration atomic from the system's
 * perspective: the second caller waits, retries until the timeout, or
 * raises POLL_LOCK_BUSY for the CLI to render a clear refusal.
 *
 * Lockfile shape (JSON at <rootDir>/.cx/runtime/inbox-poll.lock):
 *   { pid, actor, startedAt, timeoutAt? }
 *
 * Stale detection: a lock whose pid is gone, or whose timeoutAt has
 * passed, is cleared on the next acquire attempt. Mirrors the
 * lib/beads-lock.mjs API shape so callers familiar with one know the other.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const POLL_LOCK_REL_PATH = '.cx/runtime/inbox-poll.lock';
export const POLL_LOCK_BUSY = 'POLL_LOCK_BUSY';

function lockPathFor(rootDir) {
  return join(rootDir, POLL_LOCK_REL_PATH);
}

function nowIso() {
  return new Date().toISOString();
}

function afterMs(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function processExists(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readPollLock(rootDir) {
  const p = lockPathFor(rootDir);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    return raw;
  } catch {
    return null;
  }
}

export function isPollLockStale(lock) {
  if (!lock) return false;
  if (lock.pid && !processExists(lock.pid)) return true;
  if (lock.timeoutAt && new Date(lock.timeoutAt) < new Date()) return true;
  return false;
}

function clearStale(rootDir) {
  const lock = readPollLock(rootDir);
  if (lock && isPollLockStale(lock)) {
    rmSync(lockPathFor(rootDir), { force: true });
    return true;
  }
  return false;
}

function writeLockFile(rootDir, lock) {
  const p = lockPathFor(rootDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(lock, null, 2) + '\n', 'utf8');
}

/**
 * Acquire the intake poll lock. Resolves with the lock object on success,
 * rejects with an Error whose `code` is POLL_LOCK_BUSY when the wait window
 * elapses without acquisition. The rejection's `holder` field carries the
 * blocking lock's metadata for downstream error rendering.
 */
export async function acquirePollLock({
  rootDir,
  actor = 'unknown',
  command = '',
  waitMs = 0,
  timeoutMs = 5 * 60 * 1000,
  pollIntervalMs = 100,
} = {}) {
  if (!rootDir) throw new Error('acquirePollLock: rootDir is required');
  const deadline = Date.now() + Math.max(0, waitMs);

  while (true) {
    clearStale(rootDir);
    const existing = readPollLock(rootDir);
    if (!existing) {
      const lock = {
        pid: process.pid,
        actor,
        command,
        startedAt: nowIso(),
        timeoutAt: timeoutMs > 0 ? afterMs(timeoutMs) : undefined,
      };
      writeLockFile(rootDir, lock);
      return lock;
    }
    if (Date.now() >= deadline) {
      const err = new Error(
        `intake poll lock held by ${existing.actor || 'unknown'} (pid ${existing.pid}) since ${existing.startedAt}`,
      );
      err.code = POLL_LOCK_BUSY;
      err.holder = existing;
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

/**
 * Release the lock iff the calling process owns it. Returns true on release,
 * false when the lock was missing, expired, or owned by someone else.
 */
export function releasePollLock(rootDir) {
  const lock = readPollLock(rootDir);
  if (lock && lock.pid === process.pid) {
    rmSync(lockPathFor(rootDir), { force: true });
    return true;
  }
  return false;
}
