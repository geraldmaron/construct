/**
 * tests/functional/workspace-domain.functional.test.mjs — day-one proof for
 * the Workspace domain store (construct-b0nny.22, design doc §12).
 *
 * Drives the real `construct workspace-domain` CLI against one isolated sandbox
 * (CX_HOME_OVERRIDE redirected to a tmpdir, a real git fixture repo,
 * rmTmpDir teardown), mirroring tests/functional/graph-relational-store.
 * functional.test.mjs's and tests/functional/run-store-identity-convergence.
 * functional.test.mjs's isolation pattern. Spans CLI + durable-state at once
 * (CLAUDE.md's multi-component-feature rule): init/show/activate/member/
 * settings/archive through the CLI, then direct SQLite inspection proves the
 * schema came from the versioned migration path, not an inline CREATE TABLE,
 * and that the stored id equals deriveProjectKey(repo) computed independently
 * (M1 reconciliation, design doc §9).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'construct');

const { sqliteAvailable } = await import('../../lib/workspace/sqlite-db.mjs');
const { deriveProjectKey } = await import('../../lib/state-root.mjs');

if (!sqliteAvailable()) {
  test('workspace domain store skipped — node:sqlite unavailable (Node <22.5)', () => {
    assert.equal(sqliteAvailable(), false);
  });
} else {
  const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-b0nny22-home-'));
  // realpathSync: macOS's tmpdir is a symlink (/var -> /private/var) and a
  // spawned child's process.cwd() resolves through it, so the CLI's stored
  // root_path would otherwise disagree with this unresolved REPO string.
  const REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-b0nny22-repo-')));
  execFileSync('git', ['init', '-q'], { cwd: REPO });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: REPO });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: REPO });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/workspace-domain.git'], { cwd: REPO });

  const CANONICAL_ID = deriveProjectKey(REPO);

  test.after(() => {
    rmTmpDir(SANDBOX_HOME);
    rmTmpDir(REPO);
  });

  function runConstruct(args) {
    return spawnSync(process.execPath, [BIN, ...args], {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, HOME: SANDBOX_HOME, CX_HOME_OVERRIDE: SANDBOX_HOME },
    });
  }

  function runConstructJson(args) {
    const res = runConstruct(args);
    return { status: res.status, body: JSON.parse(res.stdout.slice(res.stdout.indexOf('{'))) };
  }

  // --- init: creates a provisioning workspace whose id is the canonical M1 key ---

  test('workspace init creates a provisioning workspace at the canonical deriveProjectKey id', () => {
    const { status, body } = runConstructJson(['workspace-domain', 'init', '--name=domain-test', '--json']);
    assert.equal(status, 0);
    assert.equal(body.ok, true);
    assert.equal(body.workspace.id, CANONICAL_ID, 'workspace id must equal deriveProjectKey(repo) — no second identity');
    assert.equal(body.workspace.state, 'provisioning');
    assert.equal(body.workspace.deployment, 'embedded');
    assert.equal(body.workspace.name, 'domain-test');
  });

  // --- init is idempotent (ensureWorkspace, not createWorkspace) ---

  test('workspace init is idempotent — a second call returns the same row, not an error', () => {
    const { status, body } = runConstructJson(['workspace-domain', 'init', '--json']);
    assert.equal(status, 0);
    assert.equal(body.workspace.id, CANONICAL_ID);
    assert.equal(body.workspace.name, 'domain-test', 'the already-created name is preserved, not overwritten by a bare re-init');
  });

  // --- show round-trips the created row ---

  test('workspace show round-trips the created row', () => {
    const { status, body } = runConstructJson(['workspace-domain', 'show', '--json']);
    assert.equal(status, 0);
    assert.equal(body.found, true);
    assert.equal(body.workspace.id, CANONICAL_ID);
    assert.equal(body.workspace.rootPath, REPO);
  });

  // --- activate: provisioning -> active; a second activate is rejected ---

  test('workspace activate transitions provisioning -> active; a repeat activate is rejected', () => {
    const activated = runConstructJson(['workspace-domain', 'activate', '--json']);
    assert.equal(activated.status, 0);
    assert.equal(activated.body.workspace.state, 'active');

    const again = runConstruct(['workspace-domain', 'activate', '--json']);
    assert.equal(again.status, 1, 'activating an already-active workspace must fail, not silently succeed');
    assert.match(again.stderr, /cannot transition workspace from 'active' to 'active'/);
  });

  // --- membership round-trip, including the owner-role upsert case ---

  test('workspace member add/list/remove round-trips membership', () => {
    const added = runConstructJson(['workspace-domain', 'member', 'add', 'alice@example.com', '--role=owner', '--json']);
    assert.equal(added.status, 0);
    assert.equal(added.body.member.role, 'owner');

    const listed = runConstructJson(['workspace-domain', 'member', 'list', '--json']);
    assert.equal(listed.body.members.length, 1);
    assert.equal(listed.body.members[0].memberRef, 'alice@example.com');

    // Re-adding the same member with a different role upserts, not duplicates.
    const reAdded = runConstructJson(['workspace-domain', 'member', 'add', 'alice@example.com', '--role=member', '--json']);
    assert.equal(reAdded.body.member.role, 'member');
    const listedAgain = runConstructJson(['workspace-domain', 'member', 'list', '--json']);
    assert.equal(listedAgain.body.members.length, 1, 'upsert must not create a duplicate row for the same member');

    const removed = runConstructJson(['workspace-domain', 'member', 'remove', 'alice@example.com', '--json']);
    assert.equal(removed.status, 0);
    const listedAfterRemove = runConstructJson(['workspace-domain', 'member', 'list', '--json']);
    assert.equal(listedAfterRemove.body.members.length, 0);
  });

  // --- settings round-trip through the JSON blob ---

  test('workspace settings set/get round-trips a value through the settings blob', () => {
    const set = runConstructJson(['workspace-domain', 'settings', 'set', 'retention_days', '30', '--json']);
    assert.equal(set.status, 0);
    assert.equal(set.body.settings.retention_days, 30);

    const got = runConstructJson(['workspace-domain', 'settings', 'get', 'retention_days', '--json']);
    assert.equal(got.body.value, 30);

    const list = runConstructJson(['workspace-domain', 'settings', 'list', '--json']);
    assert.equal(list.body.settings.retention_days, 30);
  });

  // --- archive: active -> archived, stamps archived_at; archived is terminal ---

  test('workspace archive transitions active -> archived and stamps archived_at; archived is terminal', () => {
    const archived = runConstructJson(['workspace-domain', 'archive', '--json']);
    assert.equal(archived.status, 0);
    assert.equal(archived.body.workspace.state, 'archived');
    assert.ok(archived.body.workspace.archivedAt, 'archived_at must be stamped on the transition');

    const reactivate = runConstruct(['workspace-domain', 'activate', '--json']);
    assert.equal(reactivate.status, 1, 'archived is terminal — no reactivation path exists');
    assert.match(reactivate.stderr, /cannot transition workspace from 'archived' to 'active'/);
  });

  // --- direct SQLite inspection: versioned migration, not an inline CREATE TABLE ---

  test('the schema was applied through the versioned migration runner, not an inline CREATE TABLE', async () => {
    const { MIGRATIONS_TABLE } = await import('../../lib/workspace/migrate-sqlite.mjs');
    const dbPath = path.join(SANDBOX_HOME, '.construct', 'projects', CANONICAL_ID, 'workspace', 'workspace.db');
    assert.ok(fs.existsSync(dbPath), `expected the workspace db at the canonical-key path: ${dbPath}`);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    try {
      const migrationRow = db.prepare(`SELECT id FROM ${MIGRATIONS_TABLE} WHERE id = ?`).get('001_workspace_foundation');
      assert.ok(migrationRow, 'expected 001_workspace_foundation to be recorded as applied');

      const workspaceRow = db.prepare('SELECT id, state FROM construct_workspaces WHERE id = ?').get(CANONICAL_ID);
      assert.equal(workspaceRow.id, CANONICAL_ID);
      assert.equal(workspaceRow.state, 'archived');
    } finally {
      db.close();
    }
  });
}
