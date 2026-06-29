/**
 * lib/storage/file-lock.mjs — Cooperative per-file locking for shared JSON stores.
 *
 * The observation, entity, and session stores are read-modify-written by both
 * CLI invocations and hook processes; concurrent writers can race and produce
 * a corrupted JSON file. This helper provides a thin lock primitive that:
 *
 *   - Creates a `<file>.lock` sidecar with O_EXCL semantics (`flag: 'wx'`)
 *   - Records the holder PID inside the lock so stale locks (from killed
 *     processes) can be detected and stolen
 *   - Spins with backoff for up to LOCK_TIMEOUT_MS before giving up
 *   - Unlocks on release, on `process.exit`, and on uncaught exceptions
 *
 * Usage:
 *
 *   await withFileLock(filePath, async () => {
 *     const data = JSON.parse(readFileSync(filePath, 'utf8'));
 *     // ...mutate
 *     writeFileSync(filePath, JSON.stringify(data));
 *   });
 *
 * The lock is best-effort: if the OS, FS, or process is in a state that
 * defeats O_EXCL, the helper falls through after the timeout and lets the
 * caller proceed. Logged regressions are surfaced via construct doctor.
 */

import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const LOCK_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 50;

const heldLocks = new Set();
const SLEEP_ARRAY = new Int32Array(new SharedArrayBuffer(4));

function isHolderAlive(holderPid) {
  if (!holderPid || !Number.isFinite(holderPid)) return false;
  try {
    process.kill(holderPid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function tryAcquire(lockPath) {
  try {
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
    heldLocks.add(lockPath);
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;

    // Steal only from a holder we can positively read as dead. An empty or
    // unreadable pidfile is the mid-create window of a live holder, not a
    // crash; stealing it would admit two writers and break an append chain.
    // The acquire timeout still bounds the wait if the holder truly crashed.

    let raw = '';
    try { raw = readFileSync(lockPath, 'utf8').trim(); } catch { return false; }
    if (raw === '') return false;
    const holder = Number(raw);
    if (!Number.isFinite(holder) || isHolderAlive(holder)) return false;

    try { unlinkSync(lockPath); } catch { /* another stealer won */ }
    try {
      writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      heldLocks.add(lockPath);
      return true;
    } catch { return false; }
  }
}

function release(lockPath) {
  if (!heldLocks.has(lockPath)) return;
  try { unlinkSync(lockPath); } catch { /* already gone */ }
  heldLocks.delete(lockPath);
}

function sleepSync(ms) {
  Atomics.wait(SLEEP_ARRAY, 0, 0, ms);
}

let exitHandlerInstalled = false;
function installExitHandler() {
  if (exitHandlerInstalled) return;
  exitHandlerInstalled = true;
  const cleanup = () => { for (const p of heldLocks) try { unlinkSync(p); } catch { /* ignore */ } };
  process.on('exit', cleanup);
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('uncaughtException', (err) => { cleanup(); throw err; });
}

/**
 * Run `fn` while holding an exclusive lock on `<filePath>.lock`. Awaits the
 * function's return value, releases the lock, and propagates any error.
 *
 * If the lock cannot be acquired within LOCK_TIMEOUT_MS, runs `fn` anyway —
 * better to lose the lock guarantee than to deadlock the caller. This is
 * cooperative locking; it relies on every writer using this helper.
 */
export async function withFileLock(filePath, fn) {
  installExitHandler();
  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (!tryAcquire(lockPath)) {
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  try {
    return await fn();
  } finally {
    release(lockPath);
  }
}

/**
 * Synchronous variant. Same contract, but for callers that cannot be async.
 * Uses a busy-wait loop; prefer `withFileLock` whenever possible.
 */
export function withFileLockSync(filePath, fn) {
  installExitHandler();
  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (!tryAcquire(lockPath)) {
    if (Date.now() >= deadline) break;
    sleepSync(POLL_INTERVAL_MS);
  }

  try {
    return fn();
  } finally {
    release(lockPath);
  }
}
