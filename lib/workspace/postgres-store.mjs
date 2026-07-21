/**
 * lib/workspace/postgres-store.mjs — Postgres backend for the Workspace
 * domain store, built for the shared workspace server
 * (construct-b0nny.26, E7; design doc synthesis/shared-server-design.md §3).
 *
 * Mirrors lib/graph/relational/postgres-store.mjs's class shape: a class over
 * the porsager/postgres tagged-template client from lib/storage/backend.mjs's
 * createSqlClient, ensureSchema() delegating to lib/db/migrate.mjs's shared
 * migration runner (lib/db/migrations/008_workspace_foundation.sql). Unlike
 * lib/workspace/store.mjs (SQLite, rootDir-keyed, derives the id internally
 * via deriveProjectKey), every method here takes an explicit `id` — the
 * server has no filesystem to derive an id from, so the caller (who does)
 * derives it locally before ever talking to the server. The id derivation
 * itself stays single-sourced in lib/state-root.mjs; this store only ever
 * stores against an id a client already computed, never mints one.
 */

export const STATE_TRANSITIONS = {
  provisioning: ['active', 'archived'],
  active: ['archived'],
  archived: [],
};

function workspaceError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function rowToWorkspace(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    remote: row.remote,
    deployment: row.deployment,
    state: row.state,
    owner: row.owner,
    settings: row.settings || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function rowToMember(row) {
  if (!row) return null;
  return { workspaceId: row.workspace_id, memberRef: row.member_ref, role: row.role, addedAt: row.added_at };
}

export class PostgresWorkspaceStore {
  constructor({ sql } = {}) {
    if (!sql) throw new Error('PostgresWorkspaceStore: sql client is required');
    this.sql = sql;
  }

  async ensureSchema() {
    const { applyMigrations } = await import('../db/migrate.mjs');
    await applyMigrations(this.sql);
  }

  async getWorkspaceRow(id) {
    const rows = await this.sql`SELECT * FROM construct_workspaces WHERE id = ${id}`;
    return rows[0] || null;
  }

  async createWorkspace(id, { name, rootPath, remote = null, deployment = 'shared' } = {}) {
    const existing = await this.getWorkspaceRow(id);
    if (existing) throw workspaceError('WORKSPACE_EXISTS', `a workspace already exists for this id: ${id}`);
    const resolvedName = name || id;
    await this.sql`
      INSERT INTO construct_workspaces (id, name, root_path, remote, deployment, state, owner, settings)
      VALUES (${id}, ${resolvedName}, ${rootPath || id}, ${remote}, ${deployment}, 'provisioning', NULL, ${this.sql.json({})})
    `;
    return rowToWorkspace(await this.getWorkspaceRow(id));
  }

  async ensureWorkspace(id, opts = {}) {
    const existing = await this.getWorkspaceRow(id);
    if (existing) return rowToWorkspace(existing);
    return this.createWorkspace(id, opts);
  }

  async getWorkspace(id) {
    return rowToWorkspace(await this.getWorkspaceRow(id));
  }

  async listWorkspaces() {
    const rows = await this.sql`SELECT * FROM construct_workspaces ORDER BY created_at`;
    return rows.map(rowToWorkspace);
  }

  async updateWorkspace(id, patch = {}) {
    const existing = await this.getWorkspaceRow(id);
    if (!existing) throw workspaceError('WORKSPACE_NOT_FOUND', `no workspace for this id: ${id}`);
    const next = {
      name: Object.hasOwn(patch, 'name') ? patch.name : existing.name,
      remote: Object.hasOwn(patch, 'remote') ? patch.remote : existing.remote,
      deployment: Object.hasOwn(patch, 'deployment') ? patch.deployment : existing.deployment,
      owner: Object.hasOwn(patch, 'owner') ? patch.owner : existing.owner,
    };
    await this.sql`
      UPDATE construct_workspaces
      SET name = ${next.name}, remote = ${next.remote}, deployment = ${next.deployment},
          owner = ${next.owner}, updated_at = now()
      WHERE id = ${id}
    `;
    return rowToWorkspace(await this.getWorkspaceRow(id));
  }

  async _transition(id, targetState, extra = {}) {
    const existing = await this.getWorkspaceRow(id);
    if (!existing) throw workspaceError('WORKSPACE_NOT_FOUND', `no workspace for this id: ${id}`);
    const allowed = STATE_TRANSITIONS[existing.state] || [];
    if (!allowed.includes(targetState)) {
      throw workspaceError('WORKSPACE_INVALID_TRANSITION', `cannot transition workspace from '${existing.state}' to '${targetState}'`);
    }
    if (targetState === 'archived') {
      await this.sql`UPDATE construct_workspaces SET state = ${targetState}, updated_at = now(), archived_at = now() WHERE id = ${id}`;
    } else {
      await this.sql`UPDATE construct_workspaces SET state = ${targetState}, updated_at = now() WHERE id = ${id}`;
    }
    return rowToWorkspace(await this.getWorkspaceRow(id));
  }

  async activateWorkspace(id) {
    return this._transition(id, 'active');
  }

  async archiveWorkspace(id) {
    return this._transition(id, 'archived');
  }

  async addMember(id, memberRef, { role = 'member' } = {}) {
    const existing = await this.getWorkspaceRow(id);
    if (!existing) throw workspaceError('WORKSPACE_NOT_FOUND', `no workspace for this id: ${id}`);
    await this.sql`
      INSERT INTO construct_workspace_members (workspace_id, member_ref, role)
      VALUES (${id}, ${memberRef}, ${role})
      ON CONFLICT (workspace_id, member_ref) DO UPDATE SET role = EXCLUDED.role
    `;
    const rows = await this.sql`SELECT * FROM construct_workspace_members WHERE workspace_id = ${id} AND member_ref = ${memberRef}`;
    return rowToMember(rows[0]);
  }

  async removeMember(id, memberRef) {
    await this.sql`DELETE FROM construct_workspace_members WHERE workspace_id = ${id} AND member_ref = ${memberRef}`;
  }

  async listMembers(id) {
    const rows = await this.sql`SELECT * FROM construct_workspace_members WHERE workspace_id = ${id} ORDER BY added_at`;
    return rows.map(rowToMember);
  }

  async getMember(id, memberRef) {
    const rows = await this.sql`SELECT * FROM construct_workspace_members WHERE workspace_id = ${id} AND member_ref = ${memberRef}`;
    return rowToMember(rows[0]);
  }

  async getSettings(id) {
    const row = await this.getWorkspaceRow(id);
    return row ? row.settings || {} : null;
  }

  async setSetting(id, key, value) {
    const existing = await this.getWorkspaceRow(id);
    if (!existing) throw workspaceError('WORKSPACE_NOT_FOUND', `no workspace for this id: ${id}`);
    const settings = { ...(existing.settings || {}), [key]: value };
    await this.sql`UPDATE construct_workspaces SET settings = ${this.sql.json(settings)}, updated_at = now() WHERE id = ${id}`;
    return settings;
  }
}
