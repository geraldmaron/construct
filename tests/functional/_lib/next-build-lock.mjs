/**
 * tests/functional/_lib/next-build-lock.mjs — Cross-process mutex that
 * serializes `next build` against apps/dashboard during the test run.
 *
 * node:test runs each *.test.mjs file in its own child process with cross-file
 * concurrency, so the dashboard-build suite (`npm --prefix apps/dashboard run
 * build`) and every dashboard server suite (`construct dashboard:sync --build`)
 * can launch `next build` at the same moment. Next.js 15 holds one build lock
 * per distDir and aborts the loser with "Another next build process is already
 * running" — the macOS/Node 22 CI flake guarded against here.
 *
 * The lock is a pid sidecar under os.tmpdir(), keyed by a hash of the repo root
 * so the worker processes of one checkout share it while parallel checkouts on
 * the same host stay independent. The O_EXCL acquire and stale-holder steal
 * mirror lib/storage/file-lock.mjs, but the wait spans a full cold build and a
 * timeout throws rather than proceeding — falling through would re-admit the
 * concurrent build the lock exists to forbid.
 */

import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const ACQUIRE_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 200;

const heldLocks = new Set();

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
    writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
    heldLocks.add(lockPath);
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;

    // Steal only from a holder positively read as dead. An empty or unreadable
    // pidfile is a live holder's mid-create window, not a crash; stealing it
    // would admit two concurrent builds. A genuinely crashed builder leaves a
    // dead pid the next waiter reclaims.

    let raw = '';
    try { raw = readFileSync(lockPath, 'utf8').trim(); } catch { return false; }
    if (raw === '') return false;
    const holder = Number(raw);
    if (!Number.isFinite(holder) || isHolderAlive(holder)) return false;

    try { unlinkSync(lockPath); } catch { /* another waiter won the steal */ }
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

let exitHandlerInstalled = false;
function installExitHandler() {
  if (exitHandlerInstalled) return;
  exitHandlerInstalled = true;

  // A killed builder cannot release on signal, so recovery rests on the
  // stale-holder steal above rather than a SIGTERM trap that would fight
  // node:test's own teardown.

  process.on('exit', () => { for (const p of heldLocks) try { unlinkSync(p); } catch { /* ignore */ } });
}

export function lockPathFor(key) {
  const digest = createHash('sha1').update(String(key)).digest('hex').slice(0, 16);
  return join(tmpdir(), `construct-next-build-${digest}.lock`);
}

/**
 * Run `fn` while holding the exclusive next-build lock for `key` (the repo
 * root). Polls until the lock is free or `timeoutMs` elapses; on timeout it
 * throws so the caller surfaces a clear failure instead of building
 * concurrently. Releases on return, throw, and process exit.
 */
export async function withNextBuildLock(key, fn, { timeoutMs = ACQUIRE_TIMEOUT_MS, pollMs = POLL_INTERVAL_MS } = {}) {
  installExitHandler();
  const lockPath = lockPathFor(key);
  const deadline = Date.now() + timeoutMs;

  while (!tryAcquire(lockPath)) {
    if (Date.now() >= deadline) {
      throw new Error(`next build lock not acquired within ${timeoutMs}ms (${lockPath})`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  try {
    return await fn();
  } finally {
    release(lockPath);
  }
}
