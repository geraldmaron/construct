/**
 * lib/storage/vector-store-recovery.mjs — LanceDB backup, restore, health, migration.
 *
 * Documents and implements recovery for the vector store under
 * `<stateRoot>/lancedb` (ADR-0066). Backups are directory copies; callers
 * should quiesce writers before backup when possible. Schema version is
 * tracked in `.construct-vector-meta.json` beside the LanceDB data directory.
 */

import fs from 'node:fs';
import path from 'node:path';

import { resolveStateDir } from '../state-root.mjs';

export const VECTOR_STORE_SCHEMA_VERSION = 1;
export const VECTOR_STORE_META_FILENAME = '.construct-vector-meta.json';

function resolveVectorStoreDir(env = process.env, rootDir = process.cwd()) {
  if (env.CONSTRUCT_LANCEDB_PATH) {
    return env.CONSTRUCT_LANCEDB_PATH;
  }
  return resolveStateDir(rootDir, 'lancedb', { ensureDir: false });
}

function metaPathForStore(storeDir) {
  return path.join(storeDir, VECTOR_STORE_META_FILENAME);
}

export function readVectorStoreMeta(storeDir) {
  const metaPath = metaPathForStore(storeDir);
  if (!fs.existsSync(metaPath)) {
    return { schemaVersion: VECTOR_STORE_SCHEMA_VERSION, createdAt: null };
  }
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (err) {
    throw new Error(`Vector store metadata corrupted at ${metaPath}: ${err.message}`);
  }
}

export function writeVectorStoreMeta(storeDir, meta = {}) {
  fs.mkdirSync(storeDir, { recursive: true });
  const payload = {
    schemaVersion: VECTOR_STORE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    ...meta,
  };
  fs.writeFileSync(metaPathForStore(storeDir), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

/**
 * Deterministic schema migration contract evaluated on store open.
 *
 * @param {{ schemaVersion?: number } | null} meta
 * @returns {{ action: 'none'|'migrate'|'unsupported', from?: number, to?: number, reason?: string }}
 */
export function evaluateSchemaMigration(meta) {
  const from = meta?.schemaVersion ?? VECTOR_STORE_SCHEMA_VERSION;
  if (from === VECTOR_STORE_SCHEMA_VERSION) {
    return { action: 'none' };
  }
  if (from < VECTOR_STORE_SCHEMA_VERSION) {
    return { action: 'migrate', from, to: VECTOR_STORE_SCHEMA_VERSION };
  }
  return {
    action: 'unsupported',
    from,
    to: VECTOR_STORE_SCHEMA_VERSION,
    reason: 'store_schema_newer_than_runtime',
  };
}

/**
 * Health probe: directory exists, LanceDB connects, trivial table listing succeeds.
 */
export async function checkVectorStoreHealth({ env = process.env, rootDir = process.cwd() } = {}) {
  const storeDir = resolveVectorStoreDir(env, rootDir);
  if (!fs.existsSync(storeDir)) {
    return { healthy: false, storeDir, reason: 'missing_directory' };
  }

  let meta;
  try {
    meta = readVectorStoreMeta(storeDir);
  } catch (err) {
    return { healthy: false, storeDir, reason: 'corrupted_metadata', error: err.message };
  }

  const migration = evaluateSchemaMigration(meta);
  if (migration.action === 'unsupported') {
    return {
      healthy: false,
      storeDir,
      reason: migration.reason,
      migration,
    };
  }

  try {
    const { VectorClient } = await import('./vector-client.mjs');
    const client = new VectorClient({ env });
    const ok = await client.isHealthy();
    await client.close().catch(() => {});
    if (!ok) {
      return { healthy: false, storeDir, reason: 'connect_failed', migration };
    }
    return {
      healthy: true,
      storeDir,
      schemaVersion: meta.schemaVersion ?? VECTOR_STORE_SCHEMA_VERSION,
      migration,
    };
  } catch (err) {
    return {
      healthy: false,
      storeDir,
      reason: 'corrupted',
      error: String(err?.message || err),
      migration,
    };
  }
}

/**
 * Copy the LanceDB directory to a backup path. Prefer quiesced writers.
 */
export function backupVectorStore({
  env = process.env,
  rootDir = process.cwd(),
  backupPath,
} = {}) {
  if (!backupPath) {
    throw new Error('backupPath is required');
  }
  const sourceDir = resolveVectorStoreDir(env, rootDir);
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Vector store directory missing: ${sourceDir}`);
  }
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.cpSync(sourceDir, backupPath, { recursive: true, force: true });
  return { sourceDir, backupPath };
}

/**
 * Restore a backup into the active vector store directory.
 */
export function restoreVectorStore({
  env = process.env,
  rootDir = process.cwd(),
  backupPath,
} = {}) {
  if (!backupPath || !fs.existsSync(backupPath)) {
    throw new Error(`Backup path missing: ${backupPath}`);
  }
  const destDir = resolveVectorStoreDir(env, rootDir);
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  fs.cpSync(backupPath, destDir, { recursive: true, force: true });
  return { backupPath, destDir };
}

export { resolveVectorStoreDir };
