/**
 * lib/beads-client.mjs — Wrapper for bd commands with lock‑management and queueing.
 *
 * All external bd calls should go through `runBd()` to ensure serialized access
 * to the embedded Dolt database.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  acquireLock,
  releaseLock,
  getLockStatus,
  cleanupStaleLock,
  enqueueRequest,
  removeFromQueue,
  readQueue,
  cleanupStaleQueue,
} from './beads-lock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuration and defaults
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS = {
  actor: 'construct',
  silent: false,
  timeoutSeconds: 30,      // Time to wait for lock before giving up
  commandTimeoutSeconds: 120, // Max runtime for the bd child process
  queuePollMs: 100,       // How often to check for lock release when queued
  maxQueueWaitSeconds: 300, // Max total time allowed in queue
};

// ---------------------------------------------------------------------------
// Core wrapper
// ---------------------------------------------------------------------------

/**
 * Run a bd command, acquiring the lock first.
 *
 * @param {string[]} args - Arguments for `bd`
 * @param {Object} [options]
 * @param {string} options.actor - Who is running this (for logging)
 * @param {number} options.timeoutSeconds - Max seconds to wait for lock
 * @param {number} options.commandTimeoutSeconds - Max seconds to let bd run after lock acquisition
 * @param {boolean} options.silent - Suppress logging of success/queue status
 * @param {string} options.cwd - Working directory (default: process.cwd())
 * @returns {Object} { success: boolean, output: string, error?: string, queued?: boolean, waitTimeMs?: number }
 */
export async function runBd(args, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const cwd = opts.cwd || process.cwd();

  // Build a human‑readable command description
  const commandDesc = args.join(' ');

  if (!opts.silent) {
    console.error(`[beads] ${opts.actor} wants to run: bd ${commandDesc}`);
  }

  // Clean up any stale locks before trying
  cleanupStaleLock({ cwd });
  cleanupStaleQueue({ cwd });

  // Try to acquire the lock
  const startWait = Date.now();
  const lock = await acquireLock({
    actor: opts.actor,
    command: commandDesc,
    timeoutSeconds: opts.timeoutSeconds,
    cwd,
  });

  if (!lock) {
    // Failed to get lock; add to queue if allowed
    const maxQueueWaitMs = opts.maxQueueWaitSeconds * 1000;
    if (Date.now() - startWait + maxQueueWaitMs > maxQueueWaitMs) {
      return {
        success: false,
        error: `Timeout waiting for lock after ${opts.timeoutSeconds}s`,
        queued: false,
      };
    }

    const queueEntry = enqueueRequest({
      actor: opts.actor,
      command: commandDesc,
      args,
      cwd,
    });

    if (!opts.silent) {
      console.error(`[beads] ↘ Added to queue (position ${readQueue({ cwd }).length})`);
    }

    // Wait in queue, polling periodically
    while (Date.now() - startWait < opts.maxQueueWaitSeconds * 1000) {
      await new Promise((resolve) => setTimeout(resolve, opts.queuePollMs));

      cleanupStaleLock({ cwd });
      const status = getLockStatus({ cwd });
      if (!status.locked) {
        // Lock free, remove from queue and try again
        removeFromQueue(queueEntry.timestamp || queueEntry.pid, { cwd });
        return await runBd(args, { ...opts, silent: true });
      }
    }

    // Queue timeout
    removeFromQueue(queueEntry.timestamp || queueEntry.pid, { cwd });
    return {
      success: false,
      error: `Timeout in queue after ${opts.maxQueueWaitSeconds}s`,
      queued: true,
      waitTimeMs: Date.now() - startWait,
    };
  }

  // We hold the lock — execute bd
  const execStart = Date.now();
  let result;
  try {
    result = spawnSync('bd', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, BEADS_ACTOR: opts.actor },
      killSignal: 'SIGTERM',
      timeout: Math.max(1, Math.round(opts.commandTimeoutSeconds * 1000)),
    });
  } finally {
    releaseLock({ cwd });
  }

  const totalTime = Date.now() - startWait;
  const execTime = Date.now() - execStart;

  if (!opts.silent) {
    console.error(`[beads] ✓ Executed in ${execTime}ms (total wait: ${totalTime}ms)`);
  }

  return {
    success: result.status === 0 && !result.error,
    output: result.stdout,
    error: result.error?.code === 'ETIMEDOUT'
      ? `bd ${commandDesc} timed out after ${opts.commandTimeoutSeconds}s`
      : (result.stderr || result.error?.message),
    exitCode: result.status,
    waitTimeMs: execStart - startWait,
    execTimeMs: execTime,
    totalTimeMs: totalTime,
  };
}

// ---------------------------------------------------------------------------
// Higher‑level convenience functions
// ---------------------------------------------------------------------------

/**
 * Quick wrapper that returns parsed JSON output.
 */
export async function runBdJson(args, options = {}) {
  const result = await runBd([...args, '--json'], options);
  if (!result.success) {
    throw new Error(`bd failed: ${result.error}`);
  }
  try {
    return JSON.parse(result.output);
  } catch (e) {
    throw new Error(`Failed to parse JSON from bd: ${e.message}\n${result.output}`);
  }
}

/**
 * Get issue list (commonly used).
 */
export async function listIssues(options = {}) {
  return runBdJson(['list'], options);
}

/**
 * Show a specific issue.
 */
export async function showIssue(id, options = {}) {
  return runBdJson(['show', id], options);
}

/**
 * Claim an issue.
 */
export async function claimIssue(id, options = {}) {
  return runBd(['update', id, '--claim'], options);
}

/**
 * Close an issue.
 */
export async function closeIssue(id, options = {}) {
  return runBd(['close', id], options);
}

/**
 * Check ready issues.
 */
export async function getReadyIssues(options = {}) {
  return runBdJson(['ready'], options);
}

/**
 * Check merge‑slot availability.
 */
export async function getMergeSlotStatus(options = {}) {
  return runBd(['merge-slot', 'check'], { silent: true, ...options });
}

/**
 * Try to acquire merge‑slot (with fallback if it doesn't exist).
 */
export async function acquireMergeSlot(options = {}) {
  const { success, error } = await runBd(['merge-slot', 'acquire'], { silent: true, ...options });
  if (!success && error?.includes('merge slot bead')) {
    // Slot might not exist; create it first
    await runBd(['merge-slot', 'create'], { silent: true, ...options });
    return runBd(['merge-slot', 'acquire'], { silent: true, ...options });
  }
  return { success, error };
}

/**
 * Release merge‑slot.
 */
export async function releaseMergeSlot(options = {}) {
  return runBd(['merge-slot', 'release'], { silent: true, ...options });
}

// ---------------------------------------------------------------------------
// Status and utility exports
// ---------------------------------------------------------------------------

export { getLockStatus, cleanupStaleLock, cleanupStaleQueue, readQueue } from './beads-lock.mjs';

/**
 * Shortcut to get current queue length.
 */
export function getQueueLength(cwd = process.cwd()) {
  return readQueue({ cwd }).length;
}

/**
 * Get human‑readable status string (lock + queue).
 */
export function getHumanStatus(cwd = process.cwd()) {
  const status = getLockStatus({ cwd });
  let out = '';
  if (status.lock) {
    const { lock } = status;
    out += `🔒 Lock held by ${lock.actor} (pid ${lock.pid})\n`;
    out += `   → ${lock.command}\n`;
    out += `   → Started: ${lock.startedAt}${lock.alive ? '' : ' ⚠️ process dead'}\n`;
  } else if (status.nativeLock) {
    const { nativeLock } = status;
    out += `🔒 Native Beads/Dolt lock held by ${nativeLock.command} (pid ${nativeLock.pid})\n`;
    out += `   → ${nativeLock.path}\n`;
  } else {
    out += '🔓 No lock held\n';
  }

  const queue = readQueue({ cwd });
  if (queue.length) {
    out += `📋 Queue (${queue.length}):\n`;
    queue.forEach((entry, idx) => {
      const alive = entry.pid && (() => {
        try { process.kill(entry.pid, 0); return true; } catch { return false; }
      })();
      out += `   ${idx + 1}. ${entry.actor} – ${entry.command || entry.args?.join(' ')}${alive ? '' : ' ⚠️ dead'}\n`;
    });
  }

  return out;
}
