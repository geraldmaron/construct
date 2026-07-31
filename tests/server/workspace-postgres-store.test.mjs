/**
 * tests/server/workspace-postgres-store.test.mjs — live Postgres coverage
 * for lib/workspace/postgres-store.mjs.
 *
 * Mirrors tests/graph/relational-postgres-store.test.mjs's and tests/
 * functional/pg-queue.functional.test.mjs's skip idiom: with no reachable
 * DATABASE_URL/CONSTRUCT_DATABASE_URL client this file records one passing
 * skip test rather than a fabricated pass. Set CONSTRUCT_REQUIRE_POSTGRES_TEST=1
 * to make absence fail.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSqlClient, closeSqlClient } from '../../lib/storage/backend.mjs';
import { PostgresWorkspaceStore } from '../../lib/workspace/postgres-store.mjs';

const sql = createSqlClient(process.env);
const requireLive = process.env.CONSTRUCT_REQUIRE_POSTGRES_TEST === '1';

if (!sql) {
  test('workspace postgres store skipped — no DATABASE_URL / sql client', () => {
    assert.equal(requireLive, false, 'CONSTRUCT_REQUIRE_POSTGRES_TEST=1 requires a live Postgres client');
  });
} else {
  const store = new PostgresWorkspaceStore({ sql });
  const id = `cx-ws-store-test-${Date.now()}`;

  test.after(async () => {
    await sql`DELETE FROM construct_workspace_members WHERE workspace_id = ${id}`;
    await sql`DELETE FROM construct_workspaces WHERE id = ${id}`;
    await closeSqlClient(sql);
  });

  test('constructor requires an sql client', () => {
    assert.throws(() => new PostgresWorkspaceStore({}), /sql client is required/);
  });

  test('createWorkspace/getWorkspace round-trip through Postgres, provisioning by default', async () => {
    await store.ensureSchema();
    const created = await store.createWorkspace(id, { name: 'PG Store Test', rootPath: '/tmp/pg-store-test' });
    assert.equal(created.id, id);
    assert.equal(created.state, 'provisioning');
    assert.equal(created.deployment, 'shared');

    const fetched = await store.getWorkspace(id);
    assert.deepEqual(fetched.settings, {});
    assert.equal(fetched.name, 'PG Store Test');
  });

  test('createWorkspace on an existing id throws WORKSPACE_EXISTS', async () => {
    await assert.rejects(
      () => store.createWorkspace(id, {}),
      (err) => err.code === 'WORKSPACE_EXISTS',
    );
  });

  test('lifecycle is forward-only: provisioning -> active -> archived, no reactivation', async () => {
    const active = await store.activateWorkspace(id);
    assert.equal(active.state, 'active');

    await assert.rejects(
      () => store.activateWorkspace(id),
      (err) => err.code === 'WORKSPACE_INVALID_TRANSITION',
    );

    const archived = await store.archiveWorkspace(id);
    assert.equal(archived.state, 'archived');
    assert.ok(archived.archivedAt);

    await assert.rejects(
      () => store.activateWorkspace(id),
      (err) => err.code === 'WORKSPACE_INVALID_TRANSITION',
    );
  });

  test('membership upsert-on-re-add and settings read-modify-write', async () => {
    const id2 = `${id}-membership`;
    await store.createWorkspace(id2, {});
    await store.addMember(id2, 'alice@example.com', { role: 'member' });
    let members = await store.listMembers(id2);
    assert.equal(members.length, 1);
    assert.equal(members[0].role, 'member');

    await store.addMember(id2, 'alice@example.com', { role: 'owner' });
    members = await store.listMembers(id2);
    assert.equal(members.length, 1, 're-adding an existing member upserts, does not duplicate');
    assert.equal(members[0].role, 'owner');

    const settings = await store.setSetting(id2, 'k', { nested: true });
    assert.deepEqual(settings, { k: { nested: true } });
    assert.deepEqual(await store.getSettings(id2), { k: { nested: true } });

    await store.removeMember(id2, 'alice@example.com');
    assert.deepEqual(await store.listMembers(id2), []);

    await sql`DELETE FROM construct_workspace_members WHERE workspace_id = ${id2}`;
    await sql`DELETE FROM construct_workspaces WHERE id = ${id2}`;
  });
}
