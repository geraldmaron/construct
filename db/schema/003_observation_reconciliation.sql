-- db/schema/003_observation_reconciliation.sql
-- Stamp each observation with the content hash and embedding model that
-- produced its vector. An idempotent reconciliation pass uses (content_hash,
-- model) to find rows whose embedding is missing or stale — content edited, or
-- the embedding model changed — and re-embed only those, rather than relying on
-- the inline write at creation time always succeeding. Mirrors the
-- (content_hash, model) tracking construct_embeddings already carries for
-- documents. Fully idempotent: safe to re-apply.

ALTER TABLE construct_observations ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE construct_observations ADD COLUMN IF NOT EXISTS model text;

CREATE INDEX IF NOT EXISTS idx_observations_content_hash ON construct_observations (content_hash);
CREATE INDEX IF NOT EXISTS idx_observations_model ON construct_observations (model);
