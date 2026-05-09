/**
 * lib/mcp/tools/storage.mjs — Storage MCP tools: status, sync, reset, and artifact deletion.
 *
 * All functions are async. Wraps lib/storage/admin.mjs and lib/storage/sync.mjs.
 * Requires confirm=true guards on destructive operations (reset, delete).
 */
import { resolve } from 'node:path';
import { deleteIngestedArtifacts, getStorageStatus, inferProjectName, purgeExpiredData, resetStorage } from '../../storage/admin.mjs';
import { syncFileStateToSql } from '../../storage/sync.mjs';

export async function storageStatus(args) {
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  const project = args.project ? String(args.project) : inferProjectName(cwd);
  return getStorageStatus(cwd, { env: process.env, project });
}

export async function storageSync(args) {
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  const project = args.project ? String(args.project) : inferProjectName(cwd);
  const syncResult = await syncFileStateToSql(cwd, { env: process.env, project });

  // Run retention purge on each sync so expired data is cleaned automatically.
  let purge = null;
  try {
    purge = await purgeExpiredData(cwd, { env: process.env, project });
  } catch { /* best effort */ }

  return purge && purge.status !== 'skipped' ? { ...syncResult, retention: purge } : syncResult;
}

export async function storageReset(args) {
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  const project = args.project ? String(args.project) : inferProjectName(cwd);
  if (args.confirm !== true) {
    return { error: 'storage_reset requires confirm=true' };
  }
  return resetStorage(cwd, {
    env: process.env,
    project,
    resetSql: args.reset_sql !== false,
    resetVector: args.reset_vector !== false,
    resetIngested: args.reset_ingested === true,
    confirm: true,
  });
}

export function deleteIngestedArtifactsTool(args) {
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  if (args.confirm !== true) {
    return { error: 'delete_ingested_artifacts requires confirm=true' };
  }
  const files = Array.isArray(args.files)
    ? args.files.map((value) => String(value))
    : [];
  try {
    return deleteIngestedArtifacts(cwd, { files, confirm: true });
  } catch (error) {
    return { error: error.message ?? String(error) };
  }
}
