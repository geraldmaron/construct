/**
 * lib/beads-optimistic.mjs — concurrent reads + retry-on-conflict writes for beads.
 *
 * Dolt commits are atomic, so it is the serializer: a write is executed and, on a
 * transient conflict, retried with exponential backoff. There is no separate
 * read-then-compare version check — that spanned two `bd` processes (a `bd show`
 * to read the commit hash, then a `bd update`) and guarded nothing, since `bd
 * update` accepts no expected version, so the window between the read and the
 * write left the "optimistic lock" unable to actually detect a conflicting commit
 * (bead construct-iufy). Reads run lock-free; `getBeadVersion` remains as an
 * advisory reader, not a write-path primitive.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_RETRY_OPTIONS = {
  maxRetries: 5,
  baseDelayMs: 50,
  maxDelayMs: 2000,
  backoffMultiplier: 2,
};

// ---------------------------------------------------------------------------
// Version tracking for optimistic locking
// ---------------------------------------------------------------------------

/**
 * Read the current version of a bead from the database (the Dolt commit hash).
 * Advisory only — exposed for callers that want to observe a bead's version; the
 * write path does not gate on it (see file header).
 */
export async function getBeadVersion(beadId, cwd = process.cwd()) {
  try {
    const result = spawnSync(
      'bd',
      ['show', beadId, '--json'],
      { cwd, encoding: 'utf8', timeout: 5000 }
    );
    
    if (result.status !== 0) return null;
    
    const data = JSON.parse(result.stdout);
    // Dolt tracks commit hashes; use as version
    return data.commitHash || data.version || Date.now().toString();
  } catch {
    return null;
  }
}

/**
 * Execute a bead write, retrying on a transient conflict. Dolt's atomic commit is
 * the serializer; this does not pre-read or compare a version (see file header).
 *
 * @param {Object} options
 * @param {Function} options.execute - Async function that performs the write
 * @param {Object} options.retry - Retry configuration
 * @returns {Promise<{success: boolean, result: any, attempts: number}>}
 */
export async function optimisticWrite({
  execute,
  retry = DEFAULT_RETRY_OPTIONS,
} = {}) {
  let attempts = 0;
  let delay = retry.baseDelayMs;

  while (attempts < retry.maxRetries) {
    attempts++;
    try {
      const result = await execute();
      return { success: true, result, attempts };
    } catch (error) {
      if (attempts >= retry.maxRetries) {
        return { success: false, error: error.message, attempts };
      }
      const jitter = Math.random() * 50;
      await new Promise((r) => setTimeout(r, delay + jitter));
      delay = Math.min(delay * retry.backoffMultiplier, retry.maxDelayMs);
    }
  }

  return { success: false, error: `Max retries (${retry.maxRetries}) exceeded`, attempts };
}

// ---------------------------------------------------------------------------
// Concurrent read operations (lock-free)
// ---------------------------------------------------------------------------

/**
 * Execute a read operation without acquiring any lock.
 * Reads are inherently safe to run concurrently.
 */
export async function concurrentRead(execute, cwd = process.cwd()) {
  try {
    const result = await execute();
    return { success: true, result };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Batch read multiple beads concurrently.
 * Much faster than sequential reads when querying multiple items.
 */
export async function batchReadBeads(beadIds, cwd = process.cwd()) {
  const promises = beadIds.map(id => 
    concurrentRead(async () => {
      const result = spawnSync(
        'bd',
        ['show', id, '--json'],
        { cwd, encoding: 'utf8', timeout: 5000 }
      );
      if (result.status !== 0) throw new Error(`Failed to read ${id}`);
      return JSON.parse(result.stdout);
    }, cwd)
  );
  
  const results = await Promise.all(promises);
  
  return {
    success: results.every(r => r.success),
    results: results.map(r => r.result),
    errors: results.filter(r => !r.success).map(r => r.error),
  };
}

// ---------------------------------------------------------------------------
// Enhanced beads client with optimistic locking
// ---------------------------------------------------------------------------

/**
 * Update a bead with optimistic locking.
 * Primary implementation for lock-free updates.
 */
export async function updateBeadOptimistic(
  beadId,
  updates,
  options = {}
) {
  const { actor = 'construct', cwd = process.cwd(), notes } = options;

  // A `bd update` on a missing bead exits non-zero and surfaces as a failed
  // result, so no separate existence pre-check is needed.
  return optimisticWrite({
    execute: async () => {
      const args = ['update', beadId];
      
      if (updates.status) args.push('--status', updates.status);
      if (updates.assignee) args.push('--assignee', updates.assignee);
      if (notes) args.push('--notes', notes);
      if (updates.labels) {
        for (const label of updates.labels) {
          args.push('--label', label);
        }
      }
      
      const result = spawnSync('bd', args, {
        cwd,
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env, BEADS_ACTOR: actor },
      });
      
      if (result.status !== 0) {
        throw new Error(result.stderr || 'Update failed');
      }
      
      return { beadId, updated: true };
    },
  });
}

/**
 * Claim a bead with optimistic locking.
 * Handles the common case of concurrent claim attempts.
 */
export async function claimBeadOptimistic(beadId, options = {}) {
  const { actor = 'construct', cwd = process.cwd() } = options;
  
  return updateBeadOptimistic(
    beadId,
    { assignee: actor },
    { actor, cwd, notes: `Claimed by ${actor}` }
  );
}

// ---------------------------------------------------------------------------
// Statistics and monitoring
// ---------------------------------------------------------------------------

/**
 * Get statistics about lock contention.
 * Useful for monitoring and tuning.
 */
export async function getContentionStats(cwd = process.cwd()) {
  const statsPath = path.join(cwd, '.beads', 'contention-stats.json');
  
  try {
    if (fs.existsSync(statsPath)) {
      return JSON.parse(fs.readFileSync(statsPath, 'utf8'));
    }
  } catch {
    // Ignore read errors
  }
  
  return {
    totalOperations: 0,
    conflicts: 0,
    retries: 0,
    avgAttempts: 1,
    lastReset: new Date().toISOString(),
  };
}

/**
 * Record operation statistics.
 */
export function recordOperationStats(
  operation,
  { success, attempts, conflict = false },
  cwd = process.cwd()
) {
  const statsPath = path.join(cwd, '.beads', 'contention-stats.json');
  
  try {
    const current = fs.existsSync(statsPath)
      ? JSON.parse(fs.readFileSync(statsPath, 'utf8'))
      : { totalOperations: 0, conflicts: 0, retries: 0, operations: {} };
    
    current.totalOperations++;
    if (conflict) current.conflicts++;
    if (attempts > 1) current.retries += (attempts - 1);
    
    // Per-operation stats
    if (!current.operations[operation]) {
      current.operations[operation] = { count: 0, conflicts: 0, avgAttempts: 1 };
    }
    const op = current.operations[operation];
    op.count++;
    if (conflict) op.conflicts++;
    op.avgAttempts = (op.avgAttempts * (op.count - 1) + attempts) / op.count;
    
    fs.writeFileSync(statsPath, JSON.stringify(current, null, 2));
  } catch {
    // Best effort - don't fail the operation
  }
}

// ---------------------------------------------------------------------------
// Migration path: backwards-compatible wrapper
// ---------------------------------------------------------------------------

/**
 * Determine if we should use optimistic locking or fall back to legacy locking.
 * Uses optimistic locking by default, unless explicitly disabled.
 */
export function shouldUseOptimisticLocking(env = process.env) {
  if (env.CONSTRUCT_BEADS_LEGACY_LOCK === '1') return false;
  if (env.CONSTRUCT_BEADS_OPTIMISTIC === 'off') return false;
  return true;
}

/**
 * Smart operation router that chooses the best strategy.
 */
export async function runBeadsOperation(operation, options = {}) {
  const {
    type = 'read', // 'read' | 'write' | 'claim' | 'update'
    beadId,
    execute,
    fallbackToLegacy = true,
    cwd = process.cwd(),
  } = options;
  
  // Reads never need locking
  if (type === 'read') {
    return concurrentRead(execute, cwd);
  }
  
  // Try optimistic locking if enabled
  if (shouldUseOptimisticLocking() && beadId) {
    const result = await optimisticWrite({
      beadId,
      execute,
      cwd,
    });
    
    recordOperationStats(operation, result, cwd);
    
    if (result.success || !fallbackToLegacy) {
      return result;
    }
    
    // Fall back to legacy locking on persistent failure
    console.error(`[beads] Optimistic locking failed, falling back to legacy lock: ${result.error}`);
  }
  
  // Legacy path: use the file-based lock
  if (fallbackToLegacy) {
    const { runBd } = await import('./beads-client.mjs');
    return runBd([operation], { cwd });
  }
  
  return { success: false, error: 'Operation failed and fallback disabled' };
}
