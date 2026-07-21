-- 008_workspace_foundation.sql — Postgres schema for the shared-mode Workspace
-- domain store (construct-b0nny.26, E7), applied via lib/db/migrate.mjs.
-- Structural parity with lib/workspace/migrations/001_workspace_foundation.sql
-- (SQLite): same table/column names and CHECK vocabularies, TEXT timestamp
-- columns promoted to TIMESTAMPTZ per docs/notes/research/workspace-control-
-- plane/synthesis/workspace-domain-design.md constraint 6's pre-declared
-- substitution — see synthesis/shared-server-design.md §3/§4 for the design
-- rationale. `id` is always a client-derived deriveProjectKey(rootDir) value
-- (lib/state-root.mjs) — this table stores against an id, it never mints one.

CREATE TABLE IF NOT EXISTS construct_workspaces (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  root_path     TEXT NOT NULL,
  remote        TEXT,
  deployment    TEXT NOT NULL DEFAULT 'shared'
                  CHECK (deployment IN ('embedded','shared')),
  state         TEXT NOT NULL DEFAULT 'provisioning'
                  CHECK (state IN ('provisioning','active','archived')),
  owner         TEXT,
  settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS construct_workspace_members (
  workspace_id  TEXT NOT NULL REFERENCES construct_workspaces(id),
  member_ref    TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member'
                  CHECK (role IN ('owner','member')),
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, member_ref)
);

CREATE INDEX IF NOT EXISTS construct_workspace_members_workspace_idx
  ON construct_workspace_members (workspace_id);
