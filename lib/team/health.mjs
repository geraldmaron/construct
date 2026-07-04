/**
 * lib/team/health.mjs — team-mode queue and worker health read model.
 */

import path from 'node:path';

import { createSqlClient, closeSqlClient } from '../storage/backend.mjs';
import { PostgresIntakeQueue } from '../queue/pg-queue.mjs';
import { WorkerRegistry } from '../orchestration/worker-runtime.mjs';
import { resolveIntakeTenantId, INTAKE_PROJECT_ENV_KEY, INTAKE_QUEUE_NAME_ENV_KEY } from '../intake/queue.mjs';

function resolveProject(rootDir, env = process.env) {
  const explicit = env?.[INTAKE_PROJECT_ENV_KEY];
  if (explicit && String(explicit).trim()) return String(explicit).trim();
  return path.basename(path.resolve(rootDir || process.cwd())).trim() || 'construct';
}

function unavailable(reason) {
  return {
    status: 'unavailable',
    reason,
    queue: null,
    workers: [],
    summary: reason === 'postgres-unavailable'
      ? 'Postgres unavailable; team queue/worker health cannot be read'
      : reason,
  };
}

export async function summarizeTeamHealth({
  rootDir = process.cwd(),
  env = process.env,
  sql = null,
} = {}) {
  const ownSql = sql || createSqlClient(env);
  if (!ownSql) return unavailable('postgres-unavailable');

  const project = resolveProject(rootDir, env);
  const tenantId = resolveIntakeTenantId(env);
  const queueName = env?.[INTAKE_QUEUE_NAME_ENV_KEY] || 'intake';
  try {
    const queue = new PostgresIntakeQueue({ sql: ownSql, project, tenantId, queueName });
    const registry = new WorkerRegistry({ sql: ownSql, project, tenantId });
    const [queueStats, workers] = await Promise.all([
      queue.queueStats(),
      registry.list({ includeStale: true }),
    ]);
    const staleWorkers = workers.filter((w) => w.stale || w.status === 'stale').length;
    const activeWorkers = workers.filter((w) => w.status === 'active' && !w.stale).length;
    const status = queueStats.deadLetter > 0 || staleWorkers > 0
      ? 'degraded'
      : 'healthy';
    return {
      status,
      project,
      tenantId,
      queue: queueStats,
      workers,
      activeWorkers,
      staleWorkers,
      deadLetter: queueStats.deadLetter,
      summary: `${queueStats.pending} pending · ${queueStats.claimed} claimed · ${queueStats.deadLetter} dead-letter · ${activeWorkers} active workers · ${staleWorkers} stale workers`,
    };
  } catch (err) {
    return {
      ...unavailable('team-health-read-failed'),
      error: err?.message || String(err),
    };
  } finally {
    if (!sql) await closeSqlClient(ownSql);
  }
}
