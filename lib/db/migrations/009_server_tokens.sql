-- 009_server_tokens.sql — bearer-token credentials for the shared workspace
-- server (construct-b0nny.26, E7), applied via lib/db/migrate.mjs. Only the
-- sha256 hash of a token is ever stored (lib/server/auth.mjs mints the raw
-- token, returns it once, and never persists it) — see synthesis/
-- shared-server-design.md §2.3. A token resolves to a membership row
-- (workspace_id, member_ref); it grants no authority beyond what that row
-- already records, and a revoked or orphaned token (its membership row
-- removed) fails auth on the very next request.

CREATE TABLE IF NOT EXISTS construct_server_tokens (
  token_hash    TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES construct_workspaces(id),
  member_ref    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS construct_server_tokens_member_idx
  ON construct_server_tokens (workspace_id, member_ref)
  WHERE revoked_at IS NULL;
