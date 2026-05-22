-- 004_recommendations.sql — Recommendations table for team and enterprise mode.
-- Solo mode uses the JSONL store under .cx/intake/ instead.
--
-- Dedup key is enforced at the (project, dedup_key) level — matches the in-memory
-- dedup contract in lib/embed/recommendation-store.mjs.
-- Active recommendations: dismissed_at IS NULL AND superseded_at IS NULL.

create table if not exists construct_recommendations (
  id text primary key,
  project text not null,
  dedup_key text not null,
  type text not null,
  title text not null,
  reason text,
  lane text,
  signal_count int not null default 1,
  total_signal_count int not null default 1,
  customer_impact int not null default 0,
  recency_bonus int not null default 0,
  strategic_bonus int not null default 0,
  score float not null default 0,
  priority text not null default 'P3',
  source_signal_ids jsonb not null default '[]'::jsonb,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  dismissed_at timestamptz,
  dismiss_reason text,
  superseded_at timestamptz,
  superseded_by_id text,
  suppressed_until timestamptz,
  suppress_reason text,
  updated_at timestamptz not null default now()
);

create unique index if not exists construct_recommendations_project_dedup_key_idx
  on construct_recommendations (project, dedup_key);

create index if not exists construct_recommendations_priority_score_idx
  on construct_recommendations (project, priority, score desc);

create index if not exists construct_recommendations_last_seen_idx
  on construct_recommendations (project, last_seen desc);

create index if not exists construct_recommendations_active_idx
  on construct_recommendations (project, dismissed_at)
  where dismissed_at is null;
