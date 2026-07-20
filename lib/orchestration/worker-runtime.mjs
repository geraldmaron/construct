/**
 * lib/orchestration/worker-runtime.mjs — team worker identity + heartbeat.
 *
 * Durable liveness sidecar for queue leases. The module does not start a worker
 * pool; it records lease ownership so status/doctor can distinguish live and
 * expired workers.
 */

import os from 'node:os';
import process from 'node:process';

import { applyMigrations } from '../db/migrate.mjs';

export const WORKER_ID_ENV_KEY = 'CONSTRUCT_WORKER_ID';
export const WORKER_TTL_ENV_KEY = 'CONSTRUCT_WORKER_TTL_SECONDS';
export const WORKER_DEFAULT_TTL_SECONDS = 120;

/**
 * First-run guidance when the shared worker registry has no Postgres URL.
 * Solo / local Construct does not require DATABASE_URL; workers list is a
 * team/shared-deployment surface over the durable worker registry.
 */
export function formatWorkersUnavailableGuidance({ reason = 'postgres-unavailable' } = {}) {
  return [
    'Workers registry unavailable — no Postgres connection.',
    `Reason: ${reason} (set DATABASE_URL or CONSTRUCT_DATABASE_URL).`,
    '',
    'When this is optional:',
    '  Solo / local Construct does not need a shared worker registry.',
    '  Use `construct orchestrate run` / host MCP tools for local orchestration.',
    '',
    'When this is required:',
    '  Team/shared deployment, `construct server`, or multi-machine worker leases.',
    '',
    'Configure:',
    '  export DATABASE_URL=postgres://user:pass@localhost:5432/construct',
    '  # or CONSTRUCT_DATABASE_URL=…',
    '  construct db migrate   # apply worker-registry schema',
    '  construct workers list',
    '',
    'See docs/guides/reference/cli/core.md (construct workers).',
  ].join('\n');
}

function defaultWorkerId(env = process.env) {
  const explicit = env?.[WORKER_ID_ENV_KEY];
  if (explicit && String(explicit).trim()) return String(explicit).trim();
  return `${os.hostname()}:${process.pid}`;
}

function normalizeTtl(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : WORKER_DEFAULT_TTL_SECONDS;
}

function normalizeCapabilities(capabilities = []) {
  return Array.isArray(capabilities)
    ? [...new Set(capabilities.map((c) => String(c).trim()).filter(Boolean))].sort()
    : [];
}

export class WorkerRegistry {
  constructor({ sql, project, tenantId = 'local' } = {}) {
    if (!sql) throw new Error('WorkerRegistry: sql client is required');
    if (!project) throw new Error('WorkerRegistry: project is required');
    this.sql = sql;
    this.project = project;
    this.tenantId = tenantId;
    this._ensured = null;
  }

  async ensureSchema() {
    if (!this._ensured) this._ensured = applyMigrations(this.sql);
    return this._ensured;
  }

  async register({
    workerId,
    env = process.env,
    host = os.hostname(),
    pid = process.pid,
    capabilities = [],
    ttlSeconds = env?.[WORKER_TTL_ENV_KEY],
    metadata = {},
  } = {}) {
    await this.ensureSchema();
    const id = workerId || defaultWorkerId(env);
    const ttl = normalizeTtl(ttlSeconds);
    const caps = normalizeCapabilities(capabilities);
    await this.sql`
      INSERT INTO construct_workers (
        project, tenant_id, worker_id, host, pid, capabilities,
        registered_at, heartbeat_at, lease_ttl_seconds, status, metadata
      ) VALUES (
        ${this.project}, ${this.tenantId}, ${id}, ${host || null}, ${Number(pid) || null},
        ${this.sql.json(caps)}, now(), now(), ${ttl}, 'active', ${this.sql.json(metadata || {})}
      )
      ON CONFLICT (project, tenant_id, worker_id) DO UPDATE SET
        host = EXCLUDED.host,
        pid = EXCLUDED.pid,
        capabilities = EXCLUDED.capabilities,
        heartbeat_at = now(),
        lease_ttl_seconds = EXCLUDED.lease_ttl_seconds,
        status = 'active',
        metadata = EXCLUDED.metadata
    `;
    return { workerId: id, project: this.project, tenantId: this.tenantId, host, pid, capabilities: caps, ttlSeconds: ttl };
  }

  async heartbeat(workerId, { ttlSeconds, renewQueue = null } = {}) {
    if (!workerId) throw new Error('heartbeat: workerId is required');
    await this.ensureSchema();
    const ttl = normalizeTtl(ttlSeconds);
    const rows = await this.sql`
      UPDATE construct_workers
      SET heartbeat_at = now(),
          lease_ttl_seconds = ${ttl},
          status = 'active'
      WHERE project = ${this.project}
        AND tenant_id = ${this.tenantId}
        AND worker_id = ${workerId}
      RETURNING worker_id, heartbeat_at, lease_ttl_seconds
    `;
    if (!rows[0]) return { workerId, renewed: false };
    if (renewQueue && typeof renewQueue.heartbeat === 'function') {
      await renewQueue.heartbeat(renewQueue.itemId, { workerId, leaseSeconds: ttl });
    }
    return {
      workerId,
      renewed: true,
      heartbeatAt: rows[0].heartbeat_at,
      ttlSeconds: rows[0].lease_ttl_seconds,
    };
  }

  async deregister(workerId) {
    if (!workerId) throw new Error('deregister: workerId is required');
    await this.ensureSchema();
    const rows = await this.sql`
      UPDATE construct_workers
      SET status = 'stopped'
      WHERE project = ${this.project}
        AND tenant_id = ${this.tenantId}
        AND worker_id = ${workerId}
      RETURNING worker_id
    `;
    return { workerId, stopped: Boolean(rows[0]) };
  }

  async list({ includeStale = true } = {}) {
    await this.ensureSchema();
    const rows = includeStale
      ? await this.sql`
          SELECT worker_id, host, pid, capabilities, registered_at, heartbeat_at,
                 lease_ttl_seconds, status, metadata,
                 (heartbeat_at + (lease_ttl_seconds * interval '1 second') < now()) AS stale
          FROM construct_workers
          WHERE project = ${this.project} AND tenant_id = ${this.tenantId}
          ORDER BY heartbeat_at DESC, worker_id ASC
        `
      : await this.sql`
          SELECT worker_id, host, pid, capabilities, registered_at, heartbeat_at,
                 lease_ttl_seconds, status, metadata,
                 (heartbeat_at + (lease_ttl_seconds * interval '1 second') < now()) AS stale
          FROM construct_workers
          WHERE project = ${this.project}
            AND tenant_id = ${this.tenantId}
            AND status = 'active'
            AND heartbeat_at + (lease_ttl_seconds * interval '1 second') >= now()
          ORDER BY heartbeat_at DESC, worker_id ASC
        `;
    return rows.map((row) => ({
      workerId: row.worker_id,
      host: row.host,
      pid: row.pid,
      capabilities: row.capabilities || [],
      registeredAt: row.registered_at,
      heartbeatAt: row.heartbeat_at,
      ttlSeconds: row.lease_ttl_seconds,
      status: row.status === 'active' && row.stale ? 'stale' : row.status,
      stale: Boolean(row.stale),
      metadata: row.metadata || {},
    }));
  }
}

export function createWorkerRegistry({ sql, project, tenantId } = {}) {
  return new WorkerRegistry({ sql, project, tenantId });
}
