-- 003_intake.sql — R&D intake queue backing table for team and enterprise mode.
-- Solo mode uses the filesystem under .cx/intake/ instead.
--
-- Worker claim algorithm: SELECT ... FROM construct_intake_items
--   WHERE status = 'pending' ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1;
-- then set status = 'claimed', claimed_by, claimed_at in the same transaction.
--
-- payload jsonb carries the rest of the intake packet (intake, triage,
-- suggestion, related, excerpt, query) so the on-disk shape and the
-- in-table shape stay aligned.

create table if not exists construct_intake_items (
  id text primary key,
  project text not null,
  tenant_id text,
  status text not null default 'pending',
  intake_type text,
  rd_stage text,
  primary_owner text,
  recommended_action text,
  risk text,
  requires_approval boolean not null default false,
  confidence double precision,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_by text,
  claimed_at timestamptz,
  processed_at timestamptz,
  processed_by text,
  notes text,
  skipped_at timestamptz,
  skipped_by text,
  skip_reason text
);

create index if not exists construct_intake_items_status_idx
  on construct_intake_items(status, created_at);

create index if not exists construct_intake_items_owner_idx
  on construct_intake_items(primary_owner, status, created_at);

create index if not exists construct_intake_items_payload_gin_idx
  on construct_intake_items using gin(payload);

create index if not exists construct_intake_items_project_tenant_idx
  on construct_intake_items(project, tenant_id, status);
