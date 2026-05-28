-- Scheduler job state for team and enterprise deployment modes.
-- Solo mode uses native trigger files instead of this table.
-- The lock_holder column stores a short identifier for the process/host
-- that currently holds the advisory lock for a running job.

create table if not exists construct_scheduled_jobs (
  id text primary key,
  schedule text not null,
  last_run_at timestamptz,
  last_run_status text,
  lock_holder text,
  lock_acquired_at timestamptz,
  created_at timestamptz not null default now()
);
