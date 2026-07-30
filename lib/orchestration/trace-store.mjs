/**
 * lib/orchestration/trace-store.mjs — team-shared trace event persistence.
 *
 * emitTraceEvent (lib/worker/trace.mjs) always writes the local, append-only
 * `.construct/traces/<date>.jsonl` shard — that stays unchanged, on every deployment
 * mode, with no credentials required. This module is the additional,
 * postgres-backed channel a run's lifecycle/worker trace events feed so a
 * team member on a different machine can read the SAME trace a worker on
 * another machine emitted — the "run/task traces -> team store" half of the
 * A1/A6 thread-vs-store boundary (see lib/storage/shared-memory.mjs for the
 * long-term-memory half).
 *
 * Solo mode (no reachable Postgres) resolves to a `kind:'none'` store whose
 * save/list are no-ops — the local JSONL trace already covers that case, and
 * a team-shared read path with nothing durable behind it would be a silent
 * lie rather than a real capability.
 *
 * Tenant scoping (A7 stage 1): every row carries a
 * `tenant_id` column and every query filters on it, matching the run store
 * (run-store-postgres.mjs) and shared-memory store (shared-memory.mjs).
 * resolveTraceStore resolves the tenant context up front and fails closed —
 * TenantResolutionError propagates uncaught — when enterprise mode has no
 * resolvable tenant id, rather than defaulting rows into a shared 'local'
 * bucket. Stage 2 (physical per-tenant isolation, per-tenant encryption) is
 * explicitly deferred and not advertised; this remains one shared table with
 * row-level tenant scoping only.
 */

import { createSqlClient } from '../storage/backend.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';
import { resolveTenantContext } from '../tenant/context.mjs';

function noneStore() {
  return {
    kind: 'none',
    saveTraceEvent: async () => ({ ok: false, reason: 'no-team-store-configured' }),
    listTeamTraces: async () => [],
  };
}

function postgresStore(sql, defaultTenantId) {
  let ensured = null;
  const ready = () => {
    if (!ensured) {
      ensured = (async () => {
        const { applyMigrations } = await import('../db/migrate.mjs');
        await applyMigrations(sql);
      })();
    }
    return ensured;
  };

  return {
    kind: 'postgres',
    tenantId: defaultTenantId,
    async saveTraceEvent(event, { project, tenantId = defaultTenantId } = {}) {
      if (!project) throw new Error('saveTraceEvent: project is required');
      if (!event?.traceId || !event?.spanId) throw new Error('saveTraceEvent: event.traceId and event.spanId are required');
      await ready();
      await sql`
        INSERT INTO construct_trace_events (
          project, tenant_id, trace_id, span_id, parent_span_id, event_type, role, task_id, metadata, created_at
        ) VALUES (
          ${project}, ${tenantId}, ${event.traceId}, ${event.spanId}, ${event.parentSpanId || null},
          ${event.eventType}, ${event.role || null}, ${event.taskId || null},
          ${sql.json(event.metadata || {})}, ${event.createdAt || new Date().toISOString()}
        )
        ON CONFLICT (project, tenant_id, trace_id, span_id) DO NOTHING
      `;
      return { ok: true };
    },
    async listTeamTraces({ project, tenantId = defaultTenantId, traceId, limit = 100 } = {}) {
      if (!project) throw new Error('listTeamTraces: project is required');
      await ready();
      const rows = traceId
        ? await sql`
            SELECT trace_id, span_id, parent_span_id, event_type, role, task_id, metadata, created_at
            FROM construct_trace_events
            WHERE project = ${project} AND tenant_id = ${tenantId} AND trace_id = ${traceId}
            ORDER BY created_at ASC
            LIMIT ${limit}
          `
        : await sql`
            SELECT trace_id, span_id, parent_span_id, event_type, role, task_id, metadata, created_at
            FROM construct_trace_events
            WHERE project = ${project} AND tenant_id = ${tenantId}
            ORDER BY created_at DESC
            LIMIT ${limit}
          `;
      return rows.map((row) => ({
        traceId: row.trace_id,
        spanId: row.span_id,
        parentSpanId: row.parent_span_id,
        eventType: row.event_type,
        role: row.role,
        taskId: row.task_id,
        metadata: row.metadata,
        createdAt: row.created_at,
      }));
    },
  };
}

/**
 * resolveTraceStore(opts)
 *
 * `sql` accepts an injected client (matching lib/team/health.mjs's
 * convention) so a caller — or a test backed by an in-memory fake — can
 * supply a shared substrate directly instead of resolving one from env.
 * Enterprise mode with no resolvable tenant id throws TenantResolutionError
 * before any query runs (fail-closed).
 *
 * @param {{ env?: object, cwd?: string, config?: object, sql?: object }} [opts]
 * @returns {{ kind: string, saveTraceEvent: Function, listTeamTraces: Function }}
 */
export function resolveTraceStore({ env = process.env, cwd = process.cwd(), config = null, sql = null } = {}) {
  const mode = getDeploymentMode(env, { cwd });
  if (mode === 'solo' && !sql) return noneStore();

  const ownSql = sql || createSqlClient(env);
  if (!ownSql) return noneStore();

  const { tenantId } = resolveTenantContext({ env, config, mode });
  return postgresStore(ownSql, tenantId);
}
