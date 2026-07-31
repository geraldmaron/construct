/**
 * lib/storage/admin.mjs — storage administration and maintenance.
 *
 * purgeExpiredData() is the TTL/size eviction path for the machine-scoped
 * observations store, backed by whichever retrieval adapter is active
 * (lib/storage/retrieval-adapter.mjs). The default/auto path targets the
 * LanceDB adapter (<stateRoot>/lancedb) and
 * never provisions it as a side effect — a project that never ran
 * `construct ingest` has no lancedb/ dir yet, so the call is a no-op rather
 * than a trigger to materialize one. An explicit
 * CONSTRUCT_RETRIEVAL_ADAPTER=keyword targets the keyword/BM25 adapter's own
 * index (<stateRoot>/keyword-index) with the same no-op-when-unprovisioned
 * guarantee. Caps resolve env var > construct.config.json
 * (resources.disk.observationsMaxDays / observationsMaxRows) > default,
 * matching the precedence documented in lib/config/project-config.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveWithinRoot } from '../path-policy.mjs';
import { projectConfigDir, configPath } from '../config-dir.mjs';
import { resolveStateDir } from '../state-root.mjs';
import { loadProjectConfig, resolveSetting } from '../config/project-config.mjs';
import { VectorClient } from './vector-client.mjs';
import { resolveAdapterMode } from './retrieval-adapter.mjs';
import { KeywordRetrievalAdapter } from './adapters/keyword-adapter.mjs';

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
  const internalDir = configPath(rootDir, 'knowledge', 'internal');
  const count = countFiles(internalDir);

  const constructExists = fsExistsSync(projectConfigDir(rootDir));

  // An explicit CONSTRUCT_RETRIEVAL_ADAPTER=keyword targets the keyword
  // adapter's own on-disk index instead of the LanceDB path below — the two
  // backends never share a status probe. 'auto'/'lancedb' keep the original
  // LanceDB-path probe unconditionally, matching probeStorageHealth
  // (lib/status.mjs) even when 'auto' would actually fall back at query time;
  // status reporting for a silent auto-fallback is tracked as follow-up.

  if (resolveAdapterMode(env) === 'keyword') {
    const keywordExists = await new KeywordRetrievalAdapter({ env, rootDir }).exists();
    return {
      backend: 'keyword',
      project,
      status: !constructExists ? 'unavailable' : keywordExists ? 'healthy' : 'degraded',
      ingested: {
        count,
        label: 'Ingested documents'
      }
    };
  }

  // Health mirrors probeStorageHealth (lib/status.mjs), derived from filesystem state
  // rather than hardcoded: no .construct/ is unavailable, no lancedb store yet is degraded
  // (no vector index), both present is healthy. The lancedb store itself resolves
  // through the same machine-scoped state root resetStorage below already
  // uses, not a project-relative `.construct/lancedb` — an override wins when set.

  const lancedbExists = fsExistsSync(env.CONSTRUCT_LANCEDB_PATH || resolveStateDir(rootDir, 'lancedb', { ensureDir: false }));
  const status = !constructExists ? 'unavailable' : lancedbExists ? 'healthy' : 'degraded';

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
    if (resolveAdapterMode(env) === 'keyword') {
      await new KeywordRetrievalAdapter({ env, rootDir }).reset();
    } else {
      const dbPath = env.CONSTRUCT_LANCEDB_PATH || resolveStateDir(rootDir, 'lancedb', { ensureDir: false });
      if (fs.existsSync(dbPath)) {
        fs.rmSync(dbPath, { recursive: true, force: true });
      }
    }
  }
  if (resetIngested) {
    const internalDir = configPath(rootDir, 'knowledge', 'internal');
    if (fs.existsSync(internalDir)) {
      fs.rmSync(internalDir, { recursive: true, force: true });
    }
  }
  return { status: 'reset', project };
}

export async function deleteIngestedArtifacts(rootDir, { files = [], confirm = false } = {}) {
  if (!confirm) throw new Error('confirm required');
  let deletedCount = 0;
  const internalDir = configPath(rootDir, 'knowledge', 'internal');
  
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
function resolvePurgeCaps(rootDir, env, maxAgeDays, maxRows) {
  const { config } = loadProjectConfig(rootDir, env);
  return {
    resolvedMaxAgeDays: maxAgeDays ?? Number(resolveSetting({
      config, env, jsonPath: 'resources.disk.observationsMaxDays',
      envKey: 'CONSTRUCT_OBSERVATIONS_MAX_DAYS', defaultValue: OBSERVATIONS_MAX_DAYS_DEFAULT,
    }).value),
    resolvedMaxRows: maxRows ?? Number(resolveSetting({
      config, env, jsonPath: 'resources.disk.observationsMaxRows',
      envKey: 'CONSTRUCT_OBSERVATIONS_MAX_ROWS', defaultValue: OBSERVATIONS_MAX_ROWS_DEFAULT,
    }).value),
  };
}

export async function purgeExpiredData(rootDir, { env = process.env, project = 'construct', maxAgeDays, maxRows } = {}) {
  // An explicit CONSTRUCT_RETRIEVAL_ADAPTER=keyword purges the keyword
  // adapter's own index instead of the LanceDB path below; 'auto'/'lancedb'
  // keep the original LanceDB-only fast path so a machine with LanceDB
  // simply never provisioned yet still short-circuits without ever touching
  // the adapter selector (which would attempt a real connect to decide).

  if (resolveAdapterMode(env) === 'keyword') {
    const adapter = new KeywordRetrievalAdapter({ env, rootDir });
    if (!(await adapter.hasObservationsTable())) {
      return { status: 'skipped', reason: 'no keyword index provisioned yet' };
    }
    const { resolvedMaxAgeDays, resolvedMaxRows } = resolvePurgeCaps(rootDir, env, maxAgeDays, maxRows);
    const result = await adapter.pruneObservations({ maxAgeDays: resolvedMaxAgeDays, maxRows: resolvedMaxRows });
    return {
      status: 'ok',
      project,
      ...result,
      sizeBytes: await adapter.sizeBytes(),
      maxAgeDays: resolvedMaxAgeDays,
      maxRows: resolvedMaxRows,
    };
  }

  const dbPath = env.CONSTRUCT_LANCEDB_PATH || resolveStateDir(rootDir, 'lancedb', { ensureDir: false });
  if (!fs.existsSync(dbPath)) {
    return { status: 'skipped', reason: 'no vector index provisioned yet' };
  }

  const { resolvedMaxAgeDays, resolvedMaxRows } = resolvePurgeCaps(rootDir, env, maxAgeDays, maxRows);

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
