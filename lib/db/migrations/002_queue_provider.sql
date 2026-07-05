CREATE TABLE IF NOT EXISTS construct_queue_items (
  project TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  queue_name TEXT NOT NULL DEFAULT 'intake',
  item_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'claimed', 'processed', 'skipped', 'awaiting_approval', 'dead_letter')
  ),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  claimed_by TEXT,
  lease_expires_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  processed_by TEXT,
  skipped_at TIMESTAMPTZ,
  skipped_by TEXT,
  terminal_reason TEXT,
  PRIMARY KEY (project, tenant_id, queue_name, item_id)
);

CREATE INDEX IF NOT EXISTS construct_queue_items_claim_idx
  ON construct_queue_items (project, tenant_id, queue_name, status, available_at, created_at);

CREATE INDEX IF NOT EXISTS construct_queue_items_lease_idx
  ON construct_queue_items (project, tenant_id, queue_name, lease_expires_at)
  WHERE status = 'claimed';

CREATE TABLE IF NOT EXISTS construct_queue_claims (
  claim_id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  queue_name TEXT NOT NULL DEFAULT 'intake',
  item_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  release_reason TEXT,
  FOREIGN KEY (project, tenant_id, queue_name, item_id)
    REFERENCES construct_queue_items (project, tenant_id, queue_name, item_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS construct_queue_claims_item_idx
  ON construct_queue_claims (project, tenant_id, queue_name, item_id, claimed_at DESC);
