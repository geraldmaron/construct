/**
 * lib/workspace/store.mjs — CRUD + lifecycle transitions for the Workspace
 * domain store (construct-b0nny.22, design doc §7).
 *
 * Every public function is keyed by `rootDir`, never a bare workspace id: the
 * id is always deriveProjectKey(rootDir) (lib/state-root.mjs, M1's canonical
 * identity derivation), computed inside this module, so there is no code path
 * here that could mint or accept a second, competing identity. Membership and
 * settings are plain data (design doc §3.2/§7) — no authorization enforcement
 * is added here; that is Policy's job (target-model.md concept 13, E6).
 */

import { deriveProjectKey } from '../state-root.mjs';
import { withWorkspaceDb } from './sqlite-db.mjs';

export const STATE_TRANSITIONS = {
  provisioning: ['active', 'archived'],
  active: ['archived'],
  archived: [],
};

function nowIso() {
  return new Date().toISOString();
}

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
    settings: JSON.parse(row.settings || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function rowToMember(row) {
  return { workspaceId: row.workspace_id, memberRef: row.member_ref, role: row.role, addedAt: row.added_at };
}

function selectWorkspaceRow(db, id) {
  return db.prepare('SELECT * FROM construct_workspaces WHERE id = ?').get(id);
}

/**
 * Create a new Workspace row. Throws WORKSPACE_EXISTS if `rootDir` already
 * has one — use ensureWorkspace for get-or-create.
 */
export function createWorkspace(rootDir, { name, remote = null, deployment = 'embedded' } = {}) {
  const id = deriveProjectKey(rootDir);
  return withWorkspaceDb(rootDir, (db) => {
    if (selectWorkspaceRow(db, id)) {
      throw workspaceError('WORKSPACE_EXISTS', `a workspace already exists for this root: ${id}`);
    }
    const ts = nowIso();
    const resolvedName = name || rootDir.split(/[\\/]/).filter(Boolean).pop() || id;
    db.prepare(`INSERT INTO construct_workspaces
        (id, name, root_path, remote, deployment, state, owner, settings, created_at, updated_at)
      VALUES (:id, :name, :root_path, :remote, :deployment, 'provisioning', NULL, '{}', :ts, :ts)`)
      .run({
        ':id': id, ':name': resolvedName, ':root_path': rootDir, ':remote': remote,
        ':deployment': deployment, ':ts': ts,
      });
    return rowToWorkspace(selectWorkspaceRow(db, id));
  });
}

/**
 * Get-or-create: returns the existing Workspace for `rootDir`, or creates
 * one in `provisioning` state. Idempotent.
 */
export function ensureWorkspace(rootDir, opts = {}) {
  const id = deriveProjectKey(rootDir);
  return withWorkspaceDb(rootDir, (db) => {
    const existing = selectWorkspaceRow(db, id);
    if (existing) return rowToWorkspace(existing);
    return null;
  }) || createWorkspace(rootDir, opts);
}

export function getWorkspace(rootDir) {
  const id = deriveProjectKey(rootDir);
  return withWorkspaceDb(rootDir, (db) => rowToWorkspace(selectWorkspaceRow(db, id)));
}

export function listWorkspaces(rootDir) {
  return withWorkspaceDb(rootDir, (db) => db.prepare('SELECT * FROM construct_workspaces ORDER BY created_at').all().map(rowToWorkspace));
}

/**
 * Update name/remote/deployment/owner. State transitions go through
 * activateWorkspace/archiveWorkspace instead, so every state change is
 * validated against STATE_TRANSITIONS rather than bypassed via a generic
 * patch.
 */
export function updateWorkspace(rootDir, patch = {}) {
  const id = deriveProjectKey(rootDir);
  const fields = ['name', 'remote', 'deployment', 'owner'].filter((f) => Object.prototype.hasOwnProperty.call(patch, f));
  return withWorkspaceDb(rootDir, (db) => {
    const existing = selectWorkspaceRow(db, id);
    if (!existing) throw workspaceError('WORKSPACE_NOT_FOUND', `no workspace for this root: ${id}`);
    if (fields.length === 0) return rowToWorkspace(existing);
    const assignments = fields.map((f) => `${f} = :${f}`).join(', ');
    const params = { ':id': id, ':ts': nowIso() };
    for (const f of fields) params[`:${f}`] = patch[f];
    db.prepare(`UPDATE construct_workspaces SET ${assignments}, updated_at = :ts WHERE id = :id`).run(params);
    return rowToWorkspace(selectWorkspaceRow(db, id));
  });
}

function transitionWorkspace(rootDir, targetState, extraAssignments = {}) {
  const id = deriveProjectKey(rootDir);
  return withWorkspaceDb(rootDir, (db) => {
    const existing = selectWorkspaceRow(db, id);
    if (!existing) throw workspaceError('WORKSPACE_NOT_FOUND', `no workspace for this root: ${id}`);
    const allowed = STATE_TRANSITIONS[existing.state] || [];
    if (!allowed.includes(targetState)) {
      throw workspaceError('WORKSPACE_INVALID_TRANSITION', `cannot transition workspace from '${existing.state}' to '${targetState}'`);
    }
    const ts = nowIso();
    const extraCols = Object.keys(extraAssignments);
    const assignments = ['state = :state', 'updated_at = :ts', ...extraCols.map((c) => `${c} = :${c}`)].join(', ');
    const params = { ':id': id, ':state': targetState, ':ts': ts };
    for (const c of extraCols) params[`:${c}`] = extraAssignments[c];
    db.prepare(`UPDATE construct_workspaces SET ${assignments} WHERE id = :id`).run(params);
    return rowToWorkspace(selectWorkspaceRow(db, id));
  });
}

export function activateWorkspace(rootDir) {
  return transitionWorkspace(rootDir, 'active');
}

export function archiveWorkspace(rootDir) {
  return transitionWorkspace(rootDir, 'archived', { archived_at: nowIso() });
}

// --- Membership ---

export function addMember(rootDir, memberRef, { role = 'member' } = {}) {
  const id = deriveProjectKey(rootDir);
  return withWorkspaceDb(rootDir, (db) => {
    if (!selectWorkspaceRow(db, id)) throw workspaceError('WORKSPACE_NOT_FOUND', `no workspace for this root: ${id}`);
    db.prepare(`INSERT INTO construct_workspace_members (workspace_id, member_ref, role, added_at)
      VALUES (:workspace_id, :member_ref, :role, :ts)
      ON CONFLICT(workspace_id, member_ref) DO UPDATE SET role = excluded.role`)
      .run({ ':workspace_id': id, ':member_ref': memberRef, ':role': role, ':ts': nowIso() });
    return rowToMember(db.prepare('SELECT * FROM construct_workspace_members WHERE workspace_id = ? AND member_ref = ?').get(id, memberRef));
  });
}

export function removeMember(rootDir, memberRef) {
  const id = deriveProjectKey(rootDir);
  return withWorkspaceDb(rootDir, (db) => {
    db.prepare('DELETE FROM construct_workspace_members WHERE workspace_id = ? AND member_ref = ?').run(id, memberRef);
  });
}

export function listMembers(rootDir) {
  const id = deriveProjectKey(rootDir);
  return withWorkspaceDb(rootDir, (db) => db.prepare('SELECT * FROM construct_workspace_members WHERE workspace_id = ? ORDER BY added_at').all(id).map(rowToMember));
}

// --- Settings ---

export function getSettings(rootDir) {
  return getWorkspace(rootDir)?.settings ?? null;
}

export function getSetting(rootDir, key) {
  const settings = getSettings(rootDir);
  return settings ? settings[key] : undefined;
}

export function setSetting(rootDir, key, value) {
  const id = deriveProjectKey(rootDir);
  return withWorkspaceDb(rootDir, (db) => {
    const existing = selectWorkspaceRow(db, id);
    if (!existing) throw workspaceError('WORKSPACE_NOT_FOUND', `no workspace for this root: ${id}`);
    const settings = JSON.parse(existing.settings || '{}');
    settings[key] = value;
    db.prepare('UPDATE construct_workspaces SET settings = :settings, updated_at = :ts WHERE id = :id')
      .run({ ':settings': JSON.stringify(settings), ':ts': nowIso(), ':id': id });
    return settings;
  });
}
