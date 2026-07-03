/**
 * lib/storage/admin.mjs — storage administration and maintenance.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveWithinRoot } from '../path-policy.mjs';

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
    const dbPath = env.CONSTRUCT_LANCEDB_PATH || path.join(rootDir, '.cx', 'lancedb');
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

export async function purgeExpiredData() {
  return { status: 'ok', purged: 0 };
}
