/**
 * lib/orchestration/run-store-postgres.mjs — Postgres-backed run store (Mode-C).
 *
 * Mirrors lib/intake/postgres-queue.mjs: a class taking the tagged-template `sql`
 * client from createSqlClient(env) (porsager/postgres style) and a project key.
 * Orchestration runs persist to `construct_orchestration_runs`; triage-like
 * columns (status, execution_mode) are flattened for filtering while the full run
 * round-trips in `payload jsonb`. Multi-project isolation comes from the
 * (run_id, project) composite primary key.
 *
 * Scope: the STORE is the deliverable. Container-worker spawning (Mode-C's
 * optional worker topology) is out of scope (ADR-0021); a Postgres run store lets
 * a team/enterprise deployment share durable runs across processes today.
 */

export class PostgresRunStore {
  constructor({ sql, project } = {}) {
    if (!sql) throw new Error('PostgresRunStore: sql client is required');
    if (!project) throw new Error('PostgresRunStore: project is required');
    this.sql = sql;
    this.project = project;
  }

  async ensureSchema() {
    await this.sql`
      CREATE TABLE IF NOT EXISTS construct_orchestration_runs (
        run_id TEXT,
        project TEXT,
        created_at TEXT,
        status TEXT,
        execution_mode TEXT,
        payload JSONB,
        PRIMARY KEY (run_id, project)
      )
    `;
  }

  async saveRun(run) {
    if (!run?.runId) throw new Error('saveRun: run.runId is required');
    await this.sql`
      INSERT INTO construct_orchestration_runs (
        run_id, project, created_at, status, execution_mode, payload
      ) VALUES (
        ${run.runId}, ${this.project}, ${run.createdAt || null},
        ${run.status || null}, ${run.execution?.executionMode || null},
        ${this.sql.json(run)}
      )
      ON CONFLICT (run_id, project) DO UPDATE SET
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
      WHERE run_id = ${runId} AND project = ${this.project}
      LIMIT 1
    `;
    return rows[0]?.payload || null;
  }

  async listRuns({ limit = 20 } = {}) {
    const rows = await this.sql`
      SELECT payload FROM construct_orchestration_runs
      WHERE project = ${this.project}
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
