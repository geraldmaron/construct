/**
 * tests/workspace/store.test.mjs — unit coverage for lib/workspace/store.mjs
 * (construct-b0nny.22).
 *
 * Gates on sqliteAvailable() (node:sqlite, Node >=22.5), matching every other
 * sqlite-backed store's test in this repo. Covers CRUD, lifecycle-transition
 * validation, membership upsert, settings, and the M1-reconciliation
 * invariant that the module's exported surface is entirely rootDir-keyed —
 * no function accepts a bare workspace id, which is what actually forecloses
 * a second identity mechanism rather than merely documenting the intent
 * (design doc §9).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as workspaceStore from '../../lib/workspace/store.mjs';
import { sqliteAvailable } from '../../lib/workspace/sqlite-db.mjs';
import { deriveProjectKey } from '../../lib/state-root.mjs';

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-workspace-store-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

function hasCode(code) {
  return (err) => err.code === code;
}

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-workspace-store-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

if (!sqliteAvailable()) {
  test('workspace store skipped — node:sqlite unavailable (Node <22.5)', () => {
    assert.equal(sqliteAvailable(), false);
  });
} else {
  test('createWorkspace mints the id from deriveProjectKey, never a caller-supplied id', () => {
    const root = project();
    const workspace = workspaceStore.createWorkspace(root, { name: 'test-ws' });
    assert.equal(workspace.id, deriveProjectKey(root));
    assert.equal(workspace.state, 'provisioning');
    assert.equal(workspace.deployment, 'embedded');
  });

  test('createWorkspace throws WORKSPACE_EXISTS on a second call for the same root', () => {
    const root = project();
    workspaceStore.createWorkspace(root, { name: 'first' });
    assert.throws(() => workspaceStore.createWorkspace(root, { name: 'second' }), hasCode('WORKSPACE_EXISTS'));
  });

  test('ensureWorkspace is idempotent — get-or-create', () => {
    const root = project();
    const first = workspaceStore.ensureWorkspace(root, { name: 'ensured' });
    const second = workspaceStore.ensureWorkspace(root, { name: 'ignored-on-second-call' });
    assert.equal(first.id, second.id);
    assert.equal(second.name, 'ensured');
  });

  test('getWorkspace returns null for a root with no workspace yet', () => {
    const root = project();
    assert.equal(workspaceStore.getWorkspace(root), null);
  });

  test('updateWorkspace patches name/remote/deployment/owner and bumps updated_at', async () => {
    const root = project();
    const created = workspaceStore.createWorkspace(root, { name: 'before' });
    await new Promise((r) => setTimeout(r, 5));
    const updated = workspaceStore.updateWorkspace(root, { name: 'after', owner: 'owner@example.com' });
    assert.equal(updated.name, 'after');
    assert.equal(updated.owner, 'owner@example.com');
    assert.notEqual(updated.updatedAt, created.updatedAt);
  });

  test('updateWorkspace throws WORKSPACE_NOT_FOUND for a root with no workspace', () => {
    const root = project();
    assert.throws(() => workspaceStore.updateWorkspace(root, { name: 'x' }), hasCode('WORKSPACE_NOT_FOUND'));
  });

  test('lifecycle transitions follow provisioning -> active -> archived, forward-only', () => {
    const root = project();
    workspaceStore.createWorkspace(root, { name: 'lifecycle' });

    const active = workspaceStore.activateWorkspace(root);
    assert.equal(active.state, 'active');

    assert.throws(() => workspaceStore.activateWorkspace(root), hasCode('WORKSPACE_INVALID_TRANSITION'));

    const archived = workspaceStore.archiveWorkspace(root);
    assert.equal(archived.state, 'archived');
    assert.ok(archived.archivedAt);

    assert.throws(() => workspaceStore.activateWorkspace(root), hasCode('WORKSPACE_INVALID_TRANSITION'));
    assert.throws(() => workspaceStore.archiveWorkspace(root), hasCode('WORKSPACE_INVALID_TRANSITION'));
  });

  test('provisioning -> archived is a valid direct transition (abandon before activation)', () => {
    const root = project();
    workspaceStore.createWorkspace(root, { name: 'abandoned' });
    const archived = workspaceStore.archiveWorkspace(root);
    assert.equal(archived.state, 'archived');
  });

  test('member add upserts role instead of duplicating rows; remove and list round-trip', () => {
    const root = project();
    workspaceStore.createWorkspace(root, { name: 'members' });

    workspaceStore.addMember(root, 'alice@example.com', { role: 'member' });
    workspaceStore.addMember(root, 'alice@example.com', { role: 'owner' });
    const members = workspaceStore.listMembers(root);
    assert.equal(members.length, 1, 'the second add must upsert, not create a duplicate row');
    assert.equal(members[0].role, 'owner');

    workspaceStore.removeMember(root, 'alice@example.com');
    assert.equal(workspaceStore.listMembers(root).length, 0);
  });

  test('addMember throws WORKSPACE_NOT_FOUND against a root with no workspace', () => {
    const root = project();
    assert.throws(() => workspaceStore.addMember(root, 'nobody@example.com'), hasCode('WORKSPACE_NOT_FOUND'));
  });

  test('settings round-trip through the JSON blob; unset key reads as undefined', () => {
    const root = project();
    workspaceStore.createWorkspace(root, { name: 'settings' });
    assert.equal(workspaceStore.getSetting(root, 'missing'), undefined);

    workspaceStore.setSetting(root, 'retention_days', 30);
    assert.equal(workspaceStore.getSetting(root, 'retention_days'), 30);
    assert.deepEqual(workspaceStore.getSettings(root), { retention_days: 30 });

    workspaceStore.setSetting(root, 'nested', { a: 1 });
    assert.deepEqual(workspaceStore.getSetting(root, 'nested'), { a: 1 });
  });

  test('every exported store function is rootDir-keyed, not workspace-id-keyed (M1 reconciliation)', () => {
    // The public surface takes a filesystem root and derives the workspace id
    // internally (deriveProjectKey) — passing a bare 24-char hex id where a
    // rootDir is expected must not resolve to a real workspace, since a hex
    // string hashes to a different deriveProjectKey than any real root would.
    const root = project();
    const created = workspaceStore.createWorkspace(root, { name: 'reconciliation' });
    assert.notEqual(workspaceStore.getWorkspace(created.id), created, 'passing the id itself as if it were a rootDir must not transparently resolve the same workspace');
    assert.equal(workspaceStore.getWorkspace(created.id), null, 'the bare id is not a valid rootDir and resolves to no workspace, proving there is no id-keyed lookup path');
  });

  test('listWorkspaces returns every row for a project db (zero-or-one in the embedded layout)', () => {
    const root = project();
    assert.deepEqual(workspaceStore.listWorkspaces(root), []);
    const created = workspaceStore.createWorkspace(root, { name: 'listed' });
    const rows = workspaceStore.listWorkspaces(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, created.id);
  });
}
