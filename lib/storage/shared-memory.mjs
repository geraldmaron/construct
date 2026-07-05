/**
 * lib/storage/shared-memory.mjs — explicit shared/private memory boundary (LMCP-G10).
 *
 * lib/observation-store.mjs persists every observation to a local,
 * project-scoped store only — there is no tier a team member on another
 * machine can read, and (per the LangGraph thread-vs-store split this bead
 * follows) nothing currently distinguishes a private session scratch note
 * from curated, team-durable project knowledge. This module is that explicit
 * tier: a record only ever reaches the shared, postgres-backed store when it
 * opts in with `visibility: 'shared-project'` AND carries non-empty
 * `provenance` — anything else (no visibility field, `visibility: 'private'`,
 * or a `sessionScratch` marker) is refused, never silently promoted.
 *
 * Solo mode (no reachable Postgres) resolves to a `kind:'none'` store whose
 * write/list are no-ops — private local memory (observation-store.mjs) is
 * unaffected either way.
 *
 * Tenant scoping (LMCP-H4, ADR-0057/A7 stage 1): every row carries a
 * `tenant_id` column and every query filters on it, matching the run store
 * (run-store-postgres.mjs) and trace store (trace-store.mjs). resolveShared-
 * MemoryStore resolves the tenant context up front and fails closed —
 * TenantResolutionError propagates uncaught — when enterprise mode has no
 * resolvable tenant id. Stage 2 (physical per-tenant isolation, per-tenant
 * encryption) is explicitly deferred and not advertised; this remains one
 * shared table with row-level tenant scoping only.
 */

import { createSqlClient } from './backend.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';
import { resolveTenantContext } from '../tenant/context.mjs';

export const SHARED_VISIBILITY = 'shared-project';

/**
 * isShareable(record)
 *
 * A record is shareable only when every one of these holds:
 *   - `visibility` is exactly 'shared-project' (default/absent means private)
 *   - `provenance` is a non-empty object (who/what produced this, re-checkable)
 *   - it does not carry a `sessionScratch` marker (an explicit private-session flag)
 *
 * @param {object} record
 * @returns {{ shareable: true } | { shareable: false, reason: string }}
 */
export function isShareable(record) {
  if (!record || typeof record !== 'object') {
    return { shareable: false, reason: 'record must be an object' };
  }
  if (record.sessionScratch) {
    return { shareable: false, reason: 'record is marked sessionScratch (private session state)' };
  }
  if (record.visibility !== SHARED_VISIBILITY) {
    return { shareable: false, reason: `visibility must be '${SHARED_VISIBILITY}' (got ${JSON.stringify(record.visibility ?? null)})` };
  }
  if (!record.provenance || typeof record.provenance !== 'object' || Array.isArray(record.provenance) || Object.keys(record.provenance).length === 0) {
    return { shareable: false, reason: 'provenance must be a non-empty object' };
  }
  if (!record.id) {
    return { shareable: false, reason: 'record.id is required' };
  }
  if (!record.category) {
    return { shareable: false, reason: 'record.category is required' };
  }
  return { shareable: true };
}

function noneStore() {
  return {
    kind: 'none',
    writeSharedMemory: async () => ({ ok: false, reason: 'no-team-store-configured' }),
    listSharedMemory: async () => [],
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
    async writeSharedMemory(record, { project, tenantId = defaultTenantId } = {}) {
      if (!project) throw new Error('writeSharedMemory: project is required');
      const check = isShareable(record);
      if (!check.shareable) return { ok: false, reason: check.reason };

      await ready();
      await sql`
        INSERT INTO construct_shared_memory (
          id, project, tenant_id, category, summary, content, tags, provenance, created_at
        ) VALUES (
          ${record.id}, ${project}, ${tenantId}, ${record.category},
          ${record.summary || null}, ${record.content || null},
          ${sql.json(record.tags || [])}, ${sql.json(record.provenance)},
          ${record.createdAt || new Date().toISOString()}
        )
        ON CONFLICT (project, tenant_id, id) DO UPDATE SET
          category = EXCLUDED.category,
          summary = EXCLUDED.summary,
          content = EXCLUDED.content,
          tags = EXCLUDED.tags,
          provenance = EXCLUDED.provenance
      `;
      return { ok: true };
    },
    async listSharedMemory({ project, tenantId = defaultTenantId, limit = 100 } = {}) {
      if (!project) throw new Error('listSharedMemory: project is required');
      await ready();
      const rows = await sql`
        SELECT id, category, summary, content, tags, provenance, created_at
        FROM construct_shared_memory
        WHERE project = ${project} AND tenant_id = ${tenantId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
      return rows.map((row) => ({
        id: row.id,
        category: row.category,
        summary: row.summary,
        content: row.content,
        tags: row.tags,
        provenance: row.provenance,
        createdAt: row.created_at,
      }));
    },
  };
}

/**
 * resolveSharedMemoryStore(opts)
 *
 * `sql` accepts an injected client (matching lib/team/health.mjs's
 * convention) so a caller — or a test backed by an in-memory fake — can
 * supply a shared substrate directly instead of resolving one from env.
 * Enterprise mode with no resolvable tenant id throws TenantResolutionError
 * before any query runs (fail-closed).
 *
 * @param {{ env?: object, cwd?: string, config?: object, sql?: object }} [opts]
 * @returns {{ kind: string, writeSharedMemory: Function, listSharedMemory: Function }}
 */
export function resolveSharedMemoryStore({ env = process.env, cwd = process.cwd(), config = null, sql = null } = {}) {
  const mode = getDeploymentMode(env, { cwd });
  if (mode === 'solo' && !sql) return noneStore();

  const ownSql = sql || createSqlClient(env);
  if (!ownSql) return noneStore();

  const { tenantId } = resolveTenantContext({ env, config, mode });
  return postgresStore(ownSql, tenantId);
}
