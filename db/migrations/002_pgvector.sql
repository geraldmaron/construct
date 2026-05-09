-- db/migrations/002_pgvector.sql
-- Enable pgvector extension and add vector-typed columns for semantic search.
-- This migration is idempotent — safe to run multiple times.

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add vector column to construct_embeddings if it doesn't exist yet
-- (The original 001_init.sql used double precision[], which we keep for backward compat)
DO $$
BEGIN
  -- Check if embedding column is still array type and needs migration
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'construct_embeddings'
      AND column_name = 'embedding'
      AND data_type = 'ARRAY'
  ) THEN
    -- Add new vector column
    ALTER TABLE construct_embeddings ADD COLUMN embedding_vec vector(384);

    -- Copy data from old array column to new vector column
    UPDATE construct_embeddings
      SET embedding_vec = embedding::vector(384);

    -- Drop old column and rename
    ALTER TABLE construct_embeddings DROP COLUMN embedding;
    ALTER TABLE construct_embeddings RENAME COLUMN embedding_vec TO embedding;
  END IF;
END $$;

-- Ensure embedding column exists as vector type (for fresh installs)
ALTER TABLE construct_embeddings
  ALTER COLUMN embedding TYPE vector(384) USING embedding::vector(384);

-- Create HNSW index for fast approximate nearest neighbor search
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw
  ON construct_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Create observations table with vector support
CREATE TABLE IF NOT EXISTS construct_observations (
  id text PRIMARY KEY,
  project text NOT NULL,
  role text NOT NULL,
  category text NOT NULL,
  summary text NOT NULL,
  content text NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence float NOT NULL DEFAULT 0.8,
  source text,
  git_sha text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  embedding vector(384)
);

-- Indexes for observations
CREATE INDEX IF NOT EXISTS idx_observations_project ON construct_observations(project);
CREATE INDEX IF NOT EXISTS idx_observations_category ON construct_observations(project, category);
CREATE INDEX IF NOT EXISTS idx_observations_created_at ON construct_observations(project, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_vector ON construct_observations USING hnsw (embedding vector_cosine_ops);

-- Create sessions table with vector support
CREATE TABLE IF NOT EXISTS construct_sessions (
  id text PRIMARY KEY,
  project text NOT NULL,
  platform text,
  summary text,
  decisions jsonb DEFAULT '[]'::jsonb,
  files_changed jsonb DEFAULT '[]'::jsonb,
  open_questions jsonb DEFAULT '[]'::jsonb,
  task_snapshot jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  embedding vector(384)
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON construct_sessions(project);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON construct_sessions(project, status);
CREATE INDEX IF NOT EXISTS idx_sessions_vector ON construct_sessions USING hnsw (embedding vector_cosine_ops);

-- Create entities table with vector support
CREATE TABLE IF NOT EXISTS construct_entities (
  name text PRIMARY KEY,
  type text NOT NULL,
  summary text,
  project text,
  observation_ids jsonb DEFAULT '[]'::jsonb,
  related_entities jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz,
  embedding vector(384)
);

CREATE INDEX IF NOT EXISTS idx_entities_type ON construct_entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_project ON construct_entities(project);
CREATE INDEX IF NOT EXISTS idx_entities_vector ON construct_entities USING hnsw (embedding vector_cosine_ops);

-- Function for searching documents by embedding
CREATE OR REPLACE FUNCTION search_documents(
  project_name text,
  query_embedding vector(384),
  match_limit int DEFAULT 10,
  min_similarity float DEFAULT 0.3
)
RETURNS TABLE(
  id text,
  title text,
  summary text,
  body text,
  source_path text,
  tags jsonb,
  kind text,
  similarity float
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.title,
    d.summary,
    d.body,
    d.source_path,
    d.tags,
    d.kind,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM construct_documents d
  JOIN construct_embeddings e ON d.id = e.document_id
  WHERE d.project = project_name
    AND 1 - (e.embedding <=> query_embedding) > min_similarity
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_limit;
END;
$$ LANGUAGE plpgsql;

-- Function for searching observations by embedding
CREATE OR REPLACE FUNCTION search_observations(
  project_name text,
  query_embedding vector(384),
  match_limit int DEFAULT 10,
  min_similarity float DEFAULT 0.3,
  filter_role text DEFAULT NULL,
  filter_category text DEFAULT NULL
)
RETURNS TABLE(
  id text,
  role text,
  category text,
  summary text,
  content text,
  tags jsonb,
  confidence float,
  source text,
  created_at timestamptz,
  similarity float
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.role,
    o.category,
    o.summary,
    o.content,
    o.tags,
    o.confidence,
    o.source,
    o.created_at,
    1 - (o.embedding <=> query_embedding) AS similarity
  FROM construct_observations o
  WHERE o.project = project_name
    AND 1 - (o.embedding <=> query_embedding) > min_similarity
    AND (filter_role IS NULL OR o.role = filter_role)
    AND (filter_category IS NULL OR o.category = filter_category)
  ORDER BY o.embedding <=> query_embedding
  LIMIT match_limit;
END;
$$ LANGUAGE plpgsql;
