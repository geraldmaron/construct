/**
 * lib/beads-client.mjs — Wrapper for bd commands with lock‑management and queueing.
 *
 * VERSION 2.0: optimistic locking by default; the exclusive file-lock fallback
 * was retired after zero telemetry firings. Writes retry via
 * Dolt versioning; reads are lock-free.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getLockStatus,
  cleanupStaleLock,
  cleanupStaleQueue,
  readQueue,
} from './beads-lock.mjs';

// Anchored bead-ID format. IDs reaching the bd shell boundary must match this;
// regex-extracted IDs from PR bodies, agent transcripts, or intake packets get
// re-validated here so a malformed value cannot reach the database. spawnSync
// uses argv-array form so shell injection isn't the failure mode — log
// corruption from a bogus ID is.

const BEAD_ID_RE = /^[a-z]+-[a-z0-9]+$/;

export function assertBeadId(id) {
  if (typeof id !== 'string' || !BEAD_ID_RE.test(id)) {
    throw new Error(`bd: invalid bead id ${JSON.stringify(id)} — expected prefix-suffix slug`);
  }
  return id;
}

import {
  concurrentRead,
  optimisticWrite,
  batchReadBeads,
  updateBeadOptimistic,
  claimBeadOptimistic,
  shouldUseOptimisticLocking,
  recordOperationStats,
} from './beads-optimistic.mjs';

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
  useOptimisticLocking: true, // NEW: Use optimistic locking by default
  fallbackToLegacy: false,
  maxRetries: 5,          // NEW: Max retries for optimistic locking
};

// Track which operations are reads vs writes
const READ_OPERATIONS = new Set([
  'list', 'show', 'ready', 'search', 'merge-slot', 'check',
  'status', 'log', 'diff', 'note',
]);

const WRITE_OPERATIONS = new Set([
  'create', 'update', 'close', 'claim', 'note', 'label',
  'assign', 'link', 'unlink', 'move', 'archive',
]);

// ---------------------------------------------------------------------------
// Operation classification
// ---------------------------------------------------------------------------

function isReadOperation(args) {
  if (!args || args.length === 0) return true;
  const cmd = args[0];
  return READ_OPERATIONS.has(cmd) || !WRITE_OPERATIONS.has(cmd);
}

function isWriteOperation(args) {
  if (!args || args.length === 0) return false;
  const cmd = args[0];
  return WRITE_OPERATIONS.has(cmd);
}

function extractBeadId(args) {
  // Try to find a bead ID in the arguments (typically the second arg)
  if (args.length >= 2 && args[1] && !args[1].startsWith('--')) {
    return args[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core wrapper with optimistic locking support
// ---------------------------------------------------------------------------

/**
 * Run a bd command with appropriate locking strategy.
 *
 * STRATEGY:
 * 1. Read operations: Lock-free concurrent execution
 * 2. Write operations: Optimistic locking with retry
 * 3. Legacy lock: Fallback only when optimistic fails
 * 
 * @param {string[]} args - Arguments for `bd`
 * @param {Object} [options]
 * @param {string} options.actor - Who is running this (for logging)
 * @param {number} options.timeoutSeconds - Max seconds to wait for lock
 * @param {number} options.commandTimeoutSeconds - Max seconds to let bd run after lock acquisition
 * @param {boolean} options.silent - Suppress logging of success/queue status
 * @param {boolean} options.useOptimisticLocking - Use optimistic locking (default: true)
 * @param {boolean} options.fallbackToLegacy - Fall back to legacy lock on failure (default: true)
 * @param {number} options.maxRetries - Max retries for optimistic locking (default: 5)
 * @param {string} options.cwd - Working directory (default: process.cwd())
 * @returns {Object} { success: boolean, output: string, error?: string, attempts?: number, method?: string }
 */
export async function runBd(args, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const cwd = opts.cwd || process.cwd();
  const commandDesc = args.join(' ');
  const isRead = isReadOperation(args);
  const beadId = extractBeadId(args);
  
  if (!opts.silent) {
    const opType = isRead ? 'read' : 'write';
    console.error(`[beads] ${opts.actor} ${opType}: bd ${commandDesc}`);
  }
  
  // ==========================================================================
  // PATH 1: Lock-free reads (fastest, most concurrent)
  // ==========================================================================
  if (isRead && opts.useOptimisticLocking) {
    const startTime = Date.now();
    
    const result = spawnSync('bd', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, BEADS_ACTOR: opts.actor },
      timeout: Math.max(1, Math.round(opts.commandTimeoutSeconds * 1000)),
    });
    
    const execTime = Date.now() - startTime;
    
    // Handle timeout error
    if (result.error?.code === 'ETIMEDOUT') {
      return {
        success: false,
        error: `bd ${commandDesc} timed out after ${opts.commandTimeoutSeconds}s`,
        exitCode: null,
        execTimeMs: execTime,
        method: 'concurrent-read',
      };
    }
    
    if (!opts.silent) {
      console.error(`[beads] ✓ Read completed in ${execTime}ms (lock-free)`);
    }
    
    return {
      success: result.status === 0 && !result.error,
      output: result.stdout,
      error: result.stderr || result.error?.message,
      exitCode: result.status,
      execTimeMs: execTime,
      method: 'concurrent-read',
    };
  }
  
  // ==========================================================================
  // PATH 2: Optimistic locking for writes (scalable, conflict-resistant)
  // ==========================================================================
  if (!isRead && opts.useOptimisticLocking && shouldUseOptimisticLocking()) {
    const startTime = Date.now();
    
    const result = await optimisticWrite({
      beadId: beadId || 'unknown',
      cwd,
      maxRetries: opts.maxRetries,
      execute: async () => {
        const execResult = spawnSync('bd', args, {
          cwd,
          encoding: 'utf8',
          env: { ...process.env, BEADS_ACTOR: opts.actor },
          timeout: Math.max(1, Math.round(opts.commandTimeoutSeconds * 1000)),
        });
        
        if (execResult.status !== 0) {
          throw new Error(execResult.stderr || 'Command failed');
        }
        
        return execResult.stdout;
      },
    });
    
    const totalTime = Date.now() - startTime;
    
    recordOperationStats(commandDesc, result, cwd);
    
    if (result.success) {
      if (!opts.silent) {
        console.error(`[beads] ✓ Write completed in ${totalTime}ms (optimistic, ${result.attempts} attempt${result.attempts !== 1 ? 's' : ''})`);
      }
      return {
        success: true,
        output: result.result,
        attempts: result.attempts,
        execTimeMs: totalTime,
        method: 'optimistic-locking',
      };
    }
    
    // Optimistic locking failed
    if (!opts.fallbackToLegacy) {
      return {
        success: false,
        error: result.error,
        attempts: result.attempts,
        method: 'optimistic-locking',
      };
    }
    
    if (!opts.silent) {
      console.error(`[beads] ⚠ Optimistic locking failed: ${result.error}`);
    }
    return {
      success: false,
      error: result.error,
      attempts: result.attempts,
      method: 'optimistic-locking',
    };
  }

  // ==========================================================================
  // PATH 3: Legacy exclusive lock (retired — stage 2)
  // ==========================================================================
  if (!isRead && !shouldUseOptimisticLocking()) {
    const startTime = Date.now();
    const result = spawnSync('bd', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, BEADS_ACTOR: opts.actor },
      timeout: Math.max(1, Math.round(opts.commandTimeoutSeconds * 1000)),
    });
    const execTime = Date.now() - startTime;
    if (result.error?.code === 'ETIMEDOUT') {
      return {
        success: false,
        error: `bd ${commandDesc} timed out after ${opts.commandTimeoutSeconds}s`,
        exitCode: null,
        execTimeMs: execTime,
        method: 'direct-write',
      };
    }
    return {
      success: result.status === 0 && !result.error,
      output: result.stdout,
      error: result.stderr || result.error?.message,
      exitCode: result.status,
      execTimeMs: execTime,
      method: 'direct-write',
    };
  }

  return {
    success: false,
    error: 'Unexpected beads routing state',
    method: 'unknown',
  };
}

// ---------------------------------------------------------------------------
// Higher‑level convenience functions (enhanced with optimistic locking)
// ---------------------------------------------------------------------------

/**
 * Quick wrapper that returns parsed JSON output.
 * Uses concurrent read (no locking) for better performance.
 */
export async function runBdJson(args, options = {}) {
  const result = await runBd([...args, '--json'], { ...options, useOptimisticLocking: true });
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
 * Uses concurrent reads for better performance.
 */
export async function listIssues(options = {}) {
  return runBdJson(['list'], { useOptimisticLocking: true, ...options });
}

/**
 * Show a specific issue.
 * Uses concurrent read (no locking needed).
 */
export async function showIssue(id, options = {}) {
  assertBeadId(id);
  return runBdJson(['show', id], { useOptimisticLocking: true, ...options });
}

/**
 * Claim an issue with optimistic locking.
 * Uses optimistic locking for better concurrency.
 */
export async function claimIssue(id, options = {}) {
  assertBeadId(id);
  // Use the specialized optimistic claim function
  const result = await claimBeadOptimistic(id, options);
  
  if (result.success) {
    return { success: true, output: JSON.stringify(result.result) };
  }

  return runBd(['update', id, '--claim'], { ...options, useOptimisticLocking: true });
}

/**
 * Close an issue.
 */
export async function closeIssue(id, options = {}) {
  assertBeadId(id);
  return runBd(['close', id], options);
}

/**
 * Check ready issues.
 * Uses concurrent read (no locking needed).
 */
export async function getReadyIssues(options = {}) {
  return runBdJson(['ready'], { useOptimisticLocking: true, ...options });
}

/**
 * Check merge‑slot availability.
 * Uses concurrent read.
 */
export async function getMergeSlotStatus(options = {}) {
  return runBd(['merge-slot', 'check'], { silent: true, useOptimisticLocking: true, ...options });
}

/**
 * Try to acquire merge‑slot (with fallback if it doesn't exist).
 * Uses optimistic locking for the acquire operation.
 */
export async function acquireMergeSlot(options = {}) {
  const { success, error } = await runBd(['merge-slot', 'acquire'], { 
    silent: true, 
    useOptimisticLocking: true,
    ...options 
  });
  
  if (!success && error?.includes('merge slot bead')) {
    // Slot might not exist; create it first
    await runBd(['merge-slot', 'create'], { silent: true, useOptimisticLocking: true, ...options });
    return runBd(['merge-slot', 'acquire'], { silent: true, useOptimisticLocking: true, ...options });
  }
  
  return { success, error };
}

/**
 * Release merge‑slot.
 */
export async function releaseMergeSlot(options = {}) {
  return runBd(['merge-slot', 'release'], { silent: true, useOptimisticLocking: true, ...options });
}

/**
 * Batch read multiple issues efficiently.
 * NEW: Concurrent batch reading for better performance.
 */
export async function batchShowIssues(ids, options = {}) {
  return batchReadBeads(ids, options.cwd || process.cwd());
}

// ---------------------------------------------------------------------------
// Status and utility exports
// ---------------------------------------------------------------------------

export { getLockStatus, cleanupStaleLock, cleanupStaleQueue, readQueue } from './beads-lock.mjs';
export { 
  getContentionStats, 
  recordOperationStats,
  shouldUseOptimisticLocking 
} from './beads-optimistic.mjs';

/**
 * Shortcut to get current queue length.
 */
export function getQueueLength(cwd = process.cwd()) {
  return readQueue({ cwd }).length;
}

/**
 * Get human‑readable status string (lock + queue + contention stats).
 * ENHANCED: Now includes optimistic locking statistics.
 */
export async function getHumanStatus(cwd = process.cwd()) {
  const status = getLockStatus({ cwd });
  
  let out = '';
  
  // Optimistic locking status
  out += 'Locking Strategy:\n';
  out += `  Mode: ${shouldUseOptimisticLocking() ? 'Optimistic (concurrent reads + versioned writes)' : 'Direct writes (optimistic disabled via CONSTRUCT_BEADS_LEGACY_LOCK=1)'}\n`;
  out += '  Exclusive file-lock fallback: retired (construct-nhn5)\n';

  try {
    const { readBeadsFallbacks } = await import('./telemetry/beads-fallback.mjs');
    const history = readBeadsFallbacks();
    if (history.length > 0) {
      out += `  Historical fallback log entries: ${history.length} (~/.construct/beads-fallback.jsonl)\n`;
    }
  } catch {
    /* optional archaeology */
  }
  
  // Try to get stats if available
  try {
    const { getContentionStats } = await import('./beads-optimistic.mjs');
    const stats = await getContentionStats(cwd);
    if (stats.totalOperations > 0) {
      out += `  Operations: ${stats.totalOperations}\n`;
      out += `  Conflicts: ${stats.conflicts} (${((stats.conflicts / stats.totalOperations) * 100).toFixed(1)}%)\n`;
      out += `  Avg attempts: ${stats.avgAttempts?.toFixed(2) || '1.00'}\n`;
    }
  } catch {
    // Stats not available, skip
  }
  
  out += '\n';
  
  // Legacy lock status (for debugging)
  if (status.lock) {
    const { lock } = status;
    out += `Legacy Lock:\n`;
    out += `  Held by: ${lock.actor} (pid ${lock.pid})\n`;
    out += `  Command: ${lock.command}\n`;
    out += `  Started: ${lock.startedAt}${lock.alive ? '' : ' ⚠️ process dead'}\n`;
  } else if (status.nativeLock) {
    const { nativeLock } = status;
    out += `Native Lock:\n`;
    out += `  Held by: ${nativeLock.command} (pid ${nativeLock.pid})\n`;
  } else {
    out += 'No lock held\n';
  }

  const queue = readQueue({ cwd });
  if (queue.length) {
    out += `\nQueue (${queue.length} waiting):\n`;
    queue.forEach((entry, idx) => {
      const alive = entry.pid && (() => {
        try { process.kill(entry.pid, 0); return true; } catch { return false; }
      })();
      out += `  ${idx + 1}. ${entry.actor} – ${entry.command || entry.args?.join(' ')}${alive ? '' : ' ⚠️ dead'}\n`;
    });
  }

  return out;
}
