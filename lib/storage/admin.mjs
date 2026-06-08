/**
 * lib/storage/admin.mjs — storage administration and maintenance.
 *
 * Stub for LanceDB-backed maintenance.
 */
import fs from 'node:fs';
import path from 'node:path';

export function inferProjectName(cwd) {
  return path.basename(cwd) || 'construct';
}

export async function getStorageStatus(rootDir, { env = process.env, project = 'construct' } = {}) {
  return {
    backend: 'lancedb',
    project,
    status: 'healthy'
  };
}

export async function resetStorage(rootDir, { env = process.env, project = 'construct', resetVector = true } = {}) {
  if (resetVector) {
    const dbPath = env.CONSTRUCT_LANCEDB_PATH || path.join(process.cwd(), '.cx', 'lancedb');
    if (fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { recursive: true, force: true });
    }
  }
  return { status: 'reset', project };
}

export async function deleteIngestedArtifacts() {
  return { status: 'not_implemented' };
}
