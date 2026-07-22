-- 001_workspace_foundation.sql — SQLite schema for the Workspace domain store
-- (construct-b0nny.22, implementing the design in docs/notes/research/
-- workspace-control-plane/synthesis/workspace-domain-design.md §4). Two
-- tables: the Workspace record itself (target-model.md concept 1's schema
-- plus owner/settings, see design doc §3.1) and its membership (design doc
-- §3.2). `id` is always deriveProjectKey(rootDir) output (lib/state-root.mjs)
-- — never minted here — so this table never becomes a second, competing
-- identity alongside M1's canonical derivation.

CREATE TABLE IF NOT EXISTS construct_workspaces (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  root_path     TEXT NOT NULL,
  remote        TEXT,
  deployment    TEXT NOT NULL DEFAULT 'embedded'
                  CHECK (deployment IN ('embedded','shared')),
  state         TEXT NOT NULL DEFAULT 'provisioning'
                  CHECK (state IN ('provisioning','active','archived')),
  owner         TEXT,
  settings      TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at   TEXT
);

CREATE TABLE IF NOT EXISTS construct_workspace_members (
  workspace_id  TEXT NOT NULL REFERENCES construct_workspaces(id),
  member_ref    TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member'
                  CHECK (role IN ('owner','member')),
  added_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace_id, member_ref)
);

CREATE INDEX IF NOT EXISTS construct_workspace_members_workspace_idx
  ON construct_workspace_members (workspace_id);
