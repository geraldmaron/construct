-- Tag attribution and migration tracking for construct_documents.
-- The construct_documents.tags JSONB column already exists in 001_init.sql.
-- This migration adds GIN indexing, attribution history, and migration audit.

create index if not exists construct_documents_tags_gin_idx
  on construct_documents using gin (tags jsonb_path_ops);

create table if not exists construct_tag_attribution (
  document_id text not null references construct_documents(id) on delete cascade,
  tag text not null,
  source text not null,  -- 'agent:classifier' | 'user' | 'curator'
  confidence numeric,
  applied_at timestamptz not null default now(),
  migrated_from text,
  primary key (document_id, tag, source)
);
create index if not exists construct_tag_attribution_tag_idx on construct_tag_attribution (tag);

create table if not exists construct_tag_migrations (
  id text primary key,
  from_tag text not null,
  to_tag text,
  executed_at timestamptz not null default now(),
  executed_by text not null,
  reason text not null,
  doc_count_before integer not null,
  doc_count_after integer,
  reversible boolean not null default true,
  rolled_back_at timestamptz
);
