-- 006_graph.sql. GraphRAG community columns for entities.
--
-- Phase C9 foundations. Adds community_id (label propagation output) and a
-- community summary table so the Pg-backed deployment can query communities
-- without a JSONL scan. Solo-mode JSONL remains the source of truth; this
-- table is the projection.

ALTER TABLE construct_entities
  ADD COLUMN IF NOT EXISTS community_id text,
  ADD COLUMN IF NOT EXISTS community_size int;

CREATE INDEX IF NOT EXISTS idx_entities_community ON construct_entities(project, community_id);

CREATE TABLE IF NOT EXISTS construct_entity_communities (
  community_id text NOT NULL,
  project text NOT NULL,
  size int NOT NULL DEFAULT 0,
  top_members jsonb DEFAULT '[]'::jsonb,
  summary text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project, community_id)
);

CREATE INDEX IF NOT EXISTS idx_communities_size ON construct_entity_communities(project, size DESC);
