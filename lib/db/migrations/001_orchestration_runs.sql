CREATE TABLE IF NOT EXISTS construct_orchestration_runs (
  run_id TEXT,
  project TEXT,
  created_at TEXT,
  status TEXT,
  execution_mode TEXT,
  payload JSONB,
  PRIMARY KEY (run_id, project)
);
