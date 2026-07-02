/**
 * lib/orchestration/store.mjs — run-store resolver for the orchestration runtime.
 *
 * One interface — saveRun(run), loadRun(runId), listRuns(opts) — over three
 * backends: filesystem (Mode-A default, zero dependency), sqlite (Mode-B,
 * node:sqlite), and postgres (Mode-C, shared team/enterprise store). The runtime
 * resolves a store through here instead of importing run-store functions
 * directly, so the backend is a deployment concern rather than a code edit.
 *
 * Selection precedence: explicit config (`orchestration.store`) or the
 * CONSTRUCT_ORCHESTRATION_STORE env override win; otherwise the deployment mode
 * decides (solo→filesystem, team/enterprise→postgres). When the chosen backend
 * is unavailable (sqlite on Node <22.5, or postgres with no DATABASE_URL / null
 * sql client) the resolver falls back to filesystem and records a warning rather
 * than failing — durability of the default tier is never sacrificed to an
 * optional one. The returned store is always async-uniform so callers await it
 * regardless of backend; the filesystem and sqlite backends resolve synchronously
 * under the hood, so the default Mode-A run record is byte-for-byte unchanged.
 */

import { getDeploymentMode } from '../deployment-mode.mjs';
import { createSqlClient } from '../storage/backend.mjs';
import { saveRun as fsSaveRun, loadRun as fsLoadRun, listRuns as fsListRuns } from './run-store.mjs';
import { sqliteAvailable, createSqliteRunStore } from './run-store-sqlite.mjs';
import { PostgresRunStore } from './run-store-postgres.mjs';

export const ORCHESTRATION_STORES = ['filesystem', 'sqlite', 'postgres'];
export const STORE_ENV_KEY = 'CONSTRUCT_ORCHESTRATION_STORE';

function filesystemStore(cwd) {
  return {
    kind: 'filesystem',
    saveRun: (run) => fsSaveRun(cwd, run),
    loadRun: (runId) => fsLoadRun(cwd, runId),
    listRuns: (opts) => fsListRuns(cwd, opts),
  };
}

function sqliteStore(cwd) {
  const store = createSqliteRunStore({ cwd });
  return {
    kind: 'sqlite',
    saveRun: (run) => store.saveRun(run),
    loadRun: (runId) => store.loadRun(runId),
    listRuns: (opts) => store.listRuns(opts),
  };
}

function postgresStore({ sql, project }) {
  const store = new PostgresRunStore({ sql, project });
  let ensured = null;
  const ready = () => {
    if (!ensured) ensured = store.ensureSchema();
    return ensured;
  };
  return {
    kind: 'postgres',
    saveRun: async (run) => { await ready(); return store.saveRun(run); },
    loadRun: async (runId) => { await ready(); return store.loadRun(runId); },
    listRuns: async (opts) => { await ready(); return store.listRuns(opts); },
  };
}

function projectKey(config, cwd) {
  return config?.deployment?.projectName || cwd || 'default';
}

function chooseBackend({ config, env, cwd }) {
  const explicit = String(env?.[STORE_ENV_KEY] || config?.orchestration?.store || '').trim().toLowerCase();
  if (ORCHESTRATION_STORES.includes(explicit)) return explicit;
  const mode = getDeploymentMode(env, { cwd });
  return mode === 'solo' ? 'filesystem' : 'postgres';
}

/**
 * Resolve a run store for the runtime.
 *
 * @param {object} opts
 * @param {object} [opts.config]   loaded project config (reads orchestration.store)
 * @param {Record<string,string>} [opts.env]
 * @param {string} [opts.cwd]
 * @returns {{ store: {kind:string, saveRun:Function, loadRun:Function, listRuns:Function}, backend: string, warnings: string[] }}
 */
export function resolveRunStore({ config = {}, env = process.env, cwd = process.cwd() } = {}) {
  const warnings = [];
  const requested = chooseBackend({ config, env, cwd });

  if (requested === 'sqlite') {
    if (sqliteAvailable()) return { store: sqliteStore(cwd), backend: 'sqlite', warnings };
    warnings.push('orchestration.store "sqlite" requires Node >=22.5 (node:sqlite unavailable); falling back to filesystem.');
    return { store: filesystemStore(cwd), backend: 'filesystem', warnings };
  }

  if (requested === 'postgres') {
    const sql = createSqlClient(env);
    if (sql) return { store: postgresStore({ sql, project: projectKey(config, cwd) }), backend: 'postgres', warnings };
    warnings.push('orchestration.store "postgres" is not supported in this build (Postgres was removed); falling back to filesystem.');
    return { store: filesystemStore(cwd), backend: 'filesystem', warnings };
  }

  return { store: filesystemStore(cwd), backend: 'filesystem', warnings };
}
