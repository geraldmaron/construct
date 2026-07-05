CREATE TABLE IF NOT EXISTS construct_workers (
  project TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  worker_id TEXT NOT NULL,
  host TEXT,
  pid INTEGER,
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_ttl_seconds INTEGER NOT NULL DEFAULT 120,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stale', 'stopped')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (project, tenant_id, worker_id)
);

CREATE INDEX IF NOT EXISTS construct_workers_heartbeat_idx
  ON construct_workers (project, tenant_id, heartbeat_at);
