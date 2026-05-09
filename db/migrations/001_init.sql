create table if not exists construct_documents (
  id text primary key,
  project text not null,
  kind text not null,
  title text not null,
  summary text,
  body text not null,
  source_path text,
  tags jsonb not null default '[]'::jsonb,
  content_hash text not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists construct_documents_project_kind_idx on construct_documents (project, kind);
create index if not exists construct_documents_content_hash_idx on construct_documents (content_hash);

create table if not exists construct_embeddings (
  document_id text primary key references construct_documents(id) on delete cascade,
  model text not null,
  embedding double precision[] not null,
  content_hash text not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists construct_embeddings_model_idx on construct_embeddings (model);

create table if not exists construct_sync_runs (
  id bigserial primary key,
  project text not null,
  source text not null,
  documents_synced integer not null default 0,
  embeddings_synced integer not null default 0,
  status text not null,
  note text,
  created_at timestamptz not null default now()
);
