CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  created_at TEXT,
  status TEXT,
  execution_mode TEXT,
  json TEXT
);
