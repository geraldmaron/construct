#!/usr/bin/env node
/**
 * lib/storage/admin.mjs — storage lifecycle helpers for status, reset, and cleanup.
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { closeSqlClient, createSqlClient, probeSqlClient, readVectorConfig } from './backend.mjs';
import { readLocalVectorIndex, writeLocalVectorIndex } from './vector-store.mjs';

const DEFAULT_INGEST_DIR = '.cx/product-intel/sources/ingested';

export function inferProjectName(rootDir) {
  return basename(resolve(rootDir)).trim() || 'construct';
}

function ingestedDir(rootDir, customDir = DEFAULT_INGEST_DIR) {
  return resolve(rootDir, customDir);
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

export function listIngestedArtifacts(rootDir, customDir = DEFAULT_INGEST_DIR) {
  const dir = ingestedDir(rootDir, customDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.md')
    .map((entry) => join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
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
