/**
 * lib/orchestration/run-store-postgres.mjs — optional Postgres run-store.
 *
 * Not "the backend". Substrate owns the queue/run-store CONTRACT;
 * git-queue is the zero-dependency DEFAULT provider. Postgres is an OPTIONAL
 * kind:'queue' provider (manifest taxonomy) that an operator selects
 * explicitly for intake queues. This class is the run-store side of the same
 * optional Postgres substrate and is consumed by lib/orchestration/store.mjs
 * when orchestration.store resolves to a reachable Postgres SQL client.
 *
 * Shape: a class taking the tagged-template `sql` client from
 * createSqlClient(env) (porsager/postgres style), a project key, and a tenant
 * id. Orchestration runs persist to `construct_orchestration_runs`;
 * triage-like columns (status, execution_mode) are flattened for filtering
 * while the full run round-trips in `payload jsonb`. Project isolation comes
 * from the (run_id, project) composite primary key; tenant scoping is a
 * queryable `tenant_id` column filtered on every
 * read — the same project's runs stay row-partitioned by tenant rather than
 * pooled. tenant_id is deliberately NOT part of the primary key: run_id is
 * already globally unique (randomUUID-derived), and folding tenant_id into
 * the key would force a destructive constraint migration for a partition
 * dimension a plain filtered index already serves. Stage 2 — physical
 * per-tenant isolation (separate schemas/databases) and per-tenant
 * encryption — is explicitly deferred and not advertised; this table remains
 * a single shared relation with row-level tenant scoping only. Container-
 * worker spawning is out of scope.
 */

export class PostgresRunStore {
  constructor({ sql, project, tenantId = 'local' } = {}) {
    if (!sql) throw new Error('PostgresRunStore: sql client is required');
    if (!project) throw new Error('PostgresRunStore: project is required');
    this.sql = sql;
    this.project = project;
    this.tenantId = tenantId;
  }

  async ensureSchema() {
    const { applyMigrations } = await import('../db/migrate.mjs');
    await applyMigrations(this.sql);
  }

  async saveRun(run) {
    if (!run?.runId) throw new Error('saveRun: run.runId is required');
    await this.sql`
      INSERT INTO construct_orchestration_runs (
        run_id, project, tenant_id, created_at, status, execution_mode, payload
      ) VALUES (
        ${run.runId}, ${this.project}, ${this.tenantId}, ${run.createdAt || null},
        ${run.status || null}, ${run.execution?.executionMode || null},
        ${this.sql.json(run)}
      )
      ON CONFLICT (run_id, project) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        created_at = EXCLUDED.created_at,
        status = EXCLUDED.status,
        execution_mode = EXCLUDED.execution_mode,
        payload = EXCLUDED.payload
    `;
    return run;
  }

  async loadRun(runId) {
    if (!runId) return null;
    const rows = await this.sql`
      SELECT payload FROM construct_orchestration_runs
      WHERE run_id = ${runId} AND project = ${this.project} AND tenant_id = ${this.tenantId}
      LIMIT 1
    `;
    return rows[0]?.payload || null;
  }

  async listRuns({ limit = 20 } = {}) {
    const rows = await this.sql`
      SELECT payload FROM construct_orchestration_runs
      WHERE project = ${this.project} AND tenant_id = ${this.tenantId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => {
      const run = row.payload || {};
      return {
        runId: run.runId,
        status: run.status,
        executionMode: run.execution?.executionMode || null,
        createdAt: run.createdAt,
        request: run.request?.summary || null,
      };
    });
  }
}
