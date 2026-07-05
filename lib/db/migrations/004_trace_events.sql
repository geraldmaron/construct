CREATE TABLE IF NOT EXISTS construct_trace_events (
  project TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  event_type TEXT NOT NULL,
  role TEXT,
  task_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project, tenant_id, trace_id, span_id)
);

CREATE INDEX IF NOT EXISTS construct_trace_events_trace_idx
  ON construct_trace_events (project, tenant_id, trace_id, created_at);
