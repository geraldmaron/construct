/**
 * lib/storage/admin.mjs — storage administration and maintenance.
 *
 * purgeExpiredData() is the TTL/size eviction path for the machine-scoped
 * vector-indexed observations store (ADR-0066: <stateRoot>/lancedb,
 * construct-rf26.17). Checking or pruning never provisions the LanceDB
 * index as a side effect — a project that never ran `construct ingest`
 * has no lancedb/ dir yet, so the call is a no-op rather than a trigger to
 * materialize one. Caps resolve env var > construct.config.json
 * (resources.disk.observationsMaxDays / observationsMaxRows) > default,
 * matching the precedence documented in lib/config/project-config.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveWithinRoot } from '../path-policy.mjs';
import { resolveStateDir } from '../state-root.mjs';
import { loadProjectConfig, resolveSetting } from '../config/project-config.mjs';
import { VectorClient } from './vector-client.mjs';

const OBSERVATIONS_MAX_DAYS_DEFAULT = 90;
const OBSERVATIONS_MAX_ROWS_DEFAULT = 5000;

export function inferProjectName(cwd) {
  return path.basename(cwd) || 'construct';
}

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) count++;
  }
  return count;
}

export async function getStorageStatus(rootDir, { env = process.env, project = 'construct', fsExistsSync = fs.existsSync } = {}) {
  const internalDir = path.join(rootDir, '.cx', 'knowledge', 'internal');
  const count = countFiles(internalDir);

  // Health mirrors probeStorageHealth (lib/status.mjs), derived from filesystem state
  // rather than hardcoded: no .cx/ is unavailable, .cx/ without a .cx/lancedb store is
  // degraded (no vector index yet), both present is healthy.

  const cxExists = fsExistsSync(path.join(rootDir, '.cx'));
  const lancedbExists = fsExistsSync(env.CONSTRUCT_LANCEDB_PATH || path.join(rootDir, '.cx', 'lancedb'));
  const status = !cxExists ? 'unavailable' : lancedbExists ? 'healthy' : 'degraded';

  return {
    backend: 'lancedb',
    project,
    status,
    ingested: {
      count,
      label: 'Ingested documents'
    }
  };
}

export async function resetStorage(rootDir, { env = process.env, project = 'construct', resetVector = true, resetIngested = false } = {}) {
  if (resetVector) {
    const dbPath = env.CONSTRUCT_LANCEDB_PATH || resolveStateDir(rootDir, 'lancedb', { ensureDir: false });
    if (fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { recursive: true, force: true });
    }
  }
  if (resetIngested) {
    const internalDir = path.join(rootDir, '.cx', 'knowledge', 'internal');
    if (fs.existsSync(internalDir)) {
      fs.rmSync(internalDir, { recursive: true, force: true });
    }
  }
  return { status: 'reset', project };
}

export async function deleteIngestedArtifacts(rootDir, { files = [], confirm = false } = {}) {
  if (!confirm) throw new Error('confirm required');
  let deletedCount = 0;
  const internalDir = path.join(rootDir, '.cx', 'knowledge', 'internal');
  
  // Resolve every model-supplied entry against the ingested root first; an escaping
  // path throws before any deletion, so a ../ traversal can neither delete an out-of-root
  // file nor partially delete the set.

  const targets = files.map((f) => resolveWithinRoot(internalDir, f));
  for (const p of targets) {
    if (fs.existsSync(p)) {
      fs.rmSync(p);
      deletedCount++;
    }
  }

  if (files.length === 0 && fs.existsSync(internalDir)) {
    const all = fs.readdirSync(internalDir);
    for (const f of all) {
      fs.rmSync(path.join(internalDir, f));
      deletedCount++;
    }
  }

  return { status: 'deleted', deletedCount };
}

// Recursive byte count for the "current size" figure doctor/prune report —
// LanceDB stores each table as a directory of Lance fragment files, so a
// single stat() on the db path itself would always read as 0.

function dirSizeBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    bytes += entry.isDirectory() ? dirSizeBytes(full) : fs.statSync(full).size;
  }
  return bytes;
}

/**
 * Evict expired/overflow rows from the machine-scoped observations_v1 table.
 * A no-op when the vector index was never provisioned — nothing to evict,
 * and provisioning one just to check would defeat the lazy-index contract.
 * Returns { status: 'skipped', reason } in that case, or
 * { status: 'ok', evictedCount, remainingCount, oldestRetainedAt, sizeBytes,
 *   maxAgeDays, maxRows } once a purge ran.
 */
export async function purgeExpiredData(rootDir, { env = process.env, project = 'construct', maxAgeDays, maxRows } = {}) {
  const dbPath = env.CONSTRUCT_LANCEDB_PATH || resolveStateDir(rootDir, 'lancedb', { ensureDir: false });
  if (!fs.existsSync(dbPath)) {
    return { status: 'skipped', reason: 'no vector index provisioned yet' };
  }

  const { config } = loadProjectConfig(rootDir, env);
  const resolvedMaxAgeDays = maxAgeDays ?? Number(resolveSetting({
    config, env, jsonPath: 'resources.disk.observationsMaxDays',
    envKey: 'CONSTRUCT_OBSERVATIONS_MAX_DAYS', defaultValue: OBSERVATIONS_MAX_DAYS_DEFAULT,
  }).value);
  const resolvedMaxRows = maxRows ?? Number(resolveSetting({
    config, env, jsonPath: 'resources.disk.observationsMaxRows',
    envKey: 'CONSTRUCT_OBSERVATIONS_MAX_ROWS', defaultValue: OBSERVATIONS_MAX_ROWS_DEFAULT,
  }).value);

  const vectorClient = new VectorClient({ env: { ...env, CONSTRUCT_LANCEDB_PATH: dbPath } });
  const result = await vectorClient.pruneObservations({ maxAgeDays: resolvedMaxAgeDays, maxRows: resolvedMaxRows });

  return {
    status: 'ok',
    project,
    ...result,
    sizeBytes: dirSizeBytes(dbPath),
    maxAgeDays: resolvedMaxAgeDays,
    maxRows: resolvedMaxRows,
  };
}
