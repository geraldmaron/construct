#!/usr/bin/env node
/**
 * lib/storage/admin.mjs — storage lifecycle helpers for status, reset, cleanup, and retention.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { closeSqlClient, createSqlClient, probeSqlClient, readVectorConfig } from './backend.mjs';
import { purgeConstructDbStashes } from './postgres-backup.mjs';
import { readLocalVectorIndex, writeLocalVectorIndex } from './vector-store.mjs';
import { KNOWLEDGE_ROOT } from '../knowledge/layout.mjs';

function ingestedDir(rootDir) {
  return resolve(rootDir, KNOWLEDGE_ROOT);
}

export function inferProjectName(rootDir) {
  return basename(resolve(rootDir)).trim() || 'construct';
}

function ensureConfirmed(confirm, action) {
  if (confirm !== true) {
    throw new Error(`${action} requires explicit confirmation`);
  }
}

function ensureInsideDir(filePath, allowedDir, action) {
  const resolvedFile = resolve(filePath);
  const resolvedDir = resolve(allowedDir);
  if (resolvedFile !== resolvedDir && !resolvedFile.startsWith(`${resolvedDir}/`)) {
    throw new Error(`${action} only allows files inside ${resolvedDir}`);
  }
}

export function listIngestedArtifacts(rootDir) {
  const dir = ingestedDir(rootDir);
  if (!existsSync(dir)) return [];
  const results = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results.sort((a, b) => a.localeCompare(b));
}

export async function getStorageStatus(rootDir, { env = process.env, project = inferProjectName(rootDir) } = {}) {
  const vector = readVectorConfig(env);
  const ingestedArtifacts = listIngestedArtifacts(rootDir);
  const localVector = vector.indexPath
    ? (() => {
        const index = readLocalVectorIndex(vector.indexPath);
        return {
          configured: true,
          indexPath: vector.indexPath,
          model: index.model,
          recordCount: index.records.length,
          updatedAt: index.updatedAt,
        };
      })()
    : {
        configured: false,
        indexPath: null,
        model: null,
        recordCount: 0,
        updatedAt: null,
      };

  const client = createSqlClient(env);
  let sql = { status: 'unavailable', message: 'No SQL store configured', project, documentCount: 0 };
  if (client) {
    try {
      const health = await probeSqlClient(client);
      if (health.status === 'healthy') {
        const rows = await client`select count(*)::int as count from construct_documents where project = ${project}`;
        sql = {
          status: 'healthy',
          message: health.message,
          project,
          documentCount: Number(rows[0]?.count || 0),
        };
      } else {
        sql = {
          status: health.status,
          message: health.message,
          project,
          documentCount: 0,
        };
      }
    } finally {
      await closeSqlClient(client);
    }
  }

  return {
    project,
    sql,
    vector,
    localVector,
    ingested: {
      dir: ingestedDir(rootDir),
      count: ingestedArtifacts.length,
      files: ingestedArtifacts,
    },
  };
}

export async function resetStorage(rootDir, {
  env = process.env,
  project = inferProjectName(rootDir),
  resetSql = true,
  resetVector = true,
  resetIngested = false,
  confirm = false,
} = {}) {
  ensureConfirmed(confirm, 'storage reset');
  const result = {
    project,
    sql: { status: 'skipped' },
    localVector: { status: 'skipped' },
    ingested: { status: 'skipped', deletedCount: 0, files: [] },
    observations: { status: 'skipped' },
    sessions: { status: 'skipped' },
    postgresStashes: { status: 'skipped' },
  };

  if (resetVector) {
    const vector = readVectorConfig(env);
    if (vector.indexPath) {
      const payload = writeLocalVectorIndex(vector.indexPath, []);
      result.localVector = {
        status: 'ok',
        indexPath: vector.indexPath,
        model: payload.model,
        recordsSynced: 0,
        updatedAt: payload.updatedAt,
      };
    } else {
      result.localVector = { status: 'unavailable', note: 'No local vector index configured' };
    }

    // Wipe observation vectors and session vectors
    const obsVectors = join(rootDir, '.cx', 'observations', 'vectors.json');
    const entityVectors = join(rootDir, '.cx', 'observations', 'entity-vectors.json');
    const sessionVectors = join(rootDir, '.cx', 'sessions', 'vectors.json');
    let wipedFiles = 0;
    for (const p of [obsVectors, entityVectors, sessionVectors]) {
      if (existsSync(p)) { rmSync(p, { force: true }); wipedFiles++; }
    }
    result.observations = { status: 'ok', wipedVectorFiles: wipedFiles };
    result.sessions = { status: 'ok', wipedVectorFiles: wipedFiles > 0 ? 1 : 0 };
  }

  if (resetSql) {
    const client = createSqlClient(env);
    if (!client) {
      result.sql = { status: 'unavailable', note: 'No DATABASE_URL configured' };
    } else {
      try {
        const ids = await client`
          select id from construct_documents where project = ${project}
        `;
        const documentIds = ids.map((row) => row.id).filter(Boolean);
        if (documentIds.length > 0) {
          await client`
            delete from construct_embeddings
            where document_id = any(${documentIds})
          `;
        }
        await client`
          delete from construct_documents where project = ${project}
        `;
        await client`
          delete from construct_sync_runs where project = ${project}
        `;
        result.sql = {
          status: 'ok',
          deletedDocuments: documentIds.length,
        };
      } catch (error) {
        result.sql = {
          status: 'degraded',
          error: error?.message || 'SQL reset failed',
        };
      } finally {
        await closeSqlClient(client);
      }
    }

    // Purge postgres stash backups
    try {
      const purged = await purgeConstructDbStashes({ keepCount: 0 });
      result.postgresStashes = { status: 'ok', purged };
    } catch (err) {
      result.postgresStashes = { status: 'degraded', error: err?.message };
    }
  }

  if (resetIngested) {
    const files = listIngestedArtifacts(rootDir);
    for (const file of files) rmSync(file, { force: true });
    result.ingested = {
      status: 'ok',
      deletedCount: files.length,
      files,
    };
  }

  return result;
}

export function validateDeleteIngestedRequest(rootDir, { files = [], confirm = false } = {}) {
  ensureConfirmed(confirm, 'ingested artifact deletion');
  const allowedDir = ingestedDir(rootDir);
  for (const file of files) ensureInsideDir(resolve(rootDir, file), allowedDir, 'ingested artifact deletion');
}

export function deleteIngestedArtifacts(rootDir, { files = [], confirm = false } = {}) {
  validateDeleteIngestedRequest(rootDir, { files, confirm });
  const allowedDir = ingestedDir(rootDir);
  const targets = files.length > 0
    ? files.map((file) => {
        const resolvedFile = resolve(rootDir, file);
        ensureInsideDir(resolvedFile, allowedDir, 'ingested artifact deletion');
        return resolvedFile;
      })
    : listIngestedArtifacts(rootDir);
  const deleted = [];
  for (const file of targets) {
    if (!existsSync(file)) continue;
    rmSync(file, { force: true });
    deleted.push(file);
  }
  return {
    status: 'ok',
    deletedCount: deleted.length,
    files: deleted,
  };
}

/**
 * Purge data older than CONSTRUCT_DATA_RETENTION_DAYS from all storage layers.
 *
 * Scope:
 *   - SQL: deletes construct_documents (+ cascading construct_embeddings) older than cutoff
 *   - Local vector index: removes records whose updatedAt is older than cutoff
 *   - Observation individual files: removes .cx/observations/<id>.json files older than cutoff
 *     and prunes them from index.json and vectors.json
 *
 * Returns a summary of what was deleted.
 */
export async function purgeExpiredData(rootDir, {
  env = process.env,
  project = inferProjectName(rootDir),
  retentionDays = null,
} = {}) {
  const days = retentionDays ?? Number(env.CONSTRUCT_DATA_RETENTION_DAYS ?? 0);
  if (!days || days <= 0) return { status: 'skipped', reason: 'CONSTRUCT_DATA_RETENTION_DAYS not set or zero' };

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = { status: 'ok', cutoff: cutoff.toISOString(), retentionDays: days, sql: null, localVector: null, observations: null };

  // SQL: delete documents older than cutoff
  const client = createSqlClient(env);
  if (client) {
    try {
      const deleted = await client`
        delete from construct_documents
        where project = ${project} and updated_at < ${cutoff}
        returning id
      `;
      await client`
        delete from construct_sync_runs
        where project = ${project} and created_at < ${cutoff}
      `;
      result.sql = { status: 'ok', deletedDocuments: deleted.length };
    } catch (error) {
      result.sql = { status: 'degraded', error: error?.message };
    } finally {
      await closeSqlClient(client);
    }
  } else {
    result.sql = { status: 'unavailable' };
  }

  // Local vector index: drop records older than cutoff
  const vector = readVectorConfig(env);
  if (vector.indexPath) {
    const index = readLocalVectorIndex(vector.indexPath);
    const before = index.records.length;
    const fresh = index.records.filter((r) => {
      if (!r.updatedAt) return true;
      return new Date(r.updatedAt) >= cutoff;
    });
    if (fresh.length < before) {
      writeLocalVectorIndex(vector.indexPath, fresh);
    }
    result.localVector = { status: 'ok', removedRecords: before - fresh.length };
  } else {
    result.localVector = { status: 'unavailable' };
  }

  // Observations: remove individual files older than cutoff
  const obsDir = join(rootDir, '.cx', 'observations');
  const obsIndexPath = join(obsDir, 'index.json');
  const obsVectorsPath = join(obsDir, 'vectors.json');
  if (existsSync(obsDir)) {
    try {
      const { readdirSync: rd, rmSync: rm, readFileSync: rf, writeFileSync: wf } = await import('node:fs');
      const files = rd(obsDir).filter((f) => f.startsWith('obs-') && f.endsWith('.json'));
      let removedObs = 0;
      const removedIds = new Set();
      for (const file of files) {
        const filePath = join(obsDir, file);
        const st = statSync(filePath);
        if (st.mtimeMs < cutoff.getTime()) {
          rm(filePath, { force: true });
          removedIds.add(file.replace('.json', ''));
          removedObs++;
        }
      }
      if (removedIds.size > 0) {
        if (existsSync(obsIndexPath)) {
          try {
            const index = JSON.parse(rf(obsIndexPath, 'utf8'));
            wf(obsIndexPath, JSON.stringify(index.filter((e) => !removedIds.has(e.id)), null, 2) + '\n');
          } catch { /* best effort */ }
        }
        if (existsSync(obsVectorsPath)) {
          try {
            const vectors = JSON.parse(rf(obsVectorsPath, 'utf8'));
            wf(obsVectorsPath, JSON.stringify(vectors.filter((v) => !removedIds.has(v.id)), null, 2) + '\n');
          } catch { /* best effort */ }
        }
      }
      result.observations = { status: 'ok', removedFiles: removedObs };
    } catch (error) {
      result.observations = { status: 'degraded', error: error?.message };
    }
  } else {
    result.observations = { status: 'unavailable' };
  }

  return result;
}
