CREATE TABLE IF NOT EXISTS construct_shared_memory (
  id TEXT NOT NULL,
  project TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  category TEXT NOT NULL,
  summary TEXT,
  content TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  provenance JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project, tenant_id, id)
);

CREATE INDEX IF NOT EXISTS construct_shared_memory_project_idx
  ON construct_shared_memory (project, tenant_id, created_at);
