ALTER TABLE construct_orchestration_runs
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'local';

CREATE INDEX IF NOT EXISTS construct_orchestration_runs_tenant_idx
  ON construct_orchestration_runs (project, tenant_id, created_at);
