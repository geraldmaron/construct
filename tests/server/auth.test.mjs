/**
 * tests/server/auth.test.mjs — unit coverage for lib/server/auth.mjs
 * (construct-b0nny.26, E7).
 *
 * A fake tagged-template sql client stands in for Postgres so these tests
 * run without a live database — the real-Postgres proof lives in
 * tests/functional/workspace-server.functional.test.mjs (gated on
 * DATABASE_URL, per the repo's established skip idiom). Covers: token hashes
 * never equal their raw value, admin-bearer verification, member-bearer
 * resolution (found / revoked / orphaned-membership all reject with the same
 * message), and requireWorkspaceAccess's workspace/role isolation checks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hashToken, mintRawToken, resolveServerAuthConfig, verifyAdminBearer,
  verifyMemberBearer, requireWorkspaceAccess, ServerAuthError, ServerAuthConfigError,
} from '../../lib/server/auth.mjs';

function fakeSql(rows) {
  const calls = [];
  const fn = (strings, ...values) => {
    calls.push({ strings, values });
    return Promise.resolve(rows);
  };
  fn.calls = calls;
  return fn;
}

test('mintRawToken produces distinct, non-trivial tokens', () => {
  const a = mintRawToken();
  const b = mintRawToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 32);
});

test('hashToken is deterministic and never equals the raw token', () => {
  const raw = mintRawToken();
  const h1 = hashToken(raw);
  const h2 = hashToken(raw);
  assert.equal(h1, h2);
  assert.notEqual(h1, raw);
});

test('resolveServerAuthConfig reports adminTokenConfigured=false when unset', () => {
  const config = resolveServerAuthConfig({});
  assert.equal(config.adminTokenConfigured, false);
  assert.equal(config.adminToken, null);
});

test('verifyAdminBearer throws ServerAuthConfigError when no admin token is configured', () => {
  const config = resolveServerAuthConfig({});
  assert.throws(() => verifyAdminBearer('Bearer anything', config), ServerAuthConfigError);
});

test('verifyAdminBearer rejects a missing/malformed header and a wrong token', () => {
  const config = resolveServerAuthConfig({ CONSTRUCT_SERVER_ADMIN_TOKEN: 'right-token' });
  assert.throws(() => verifyAdminBearer(undefined, config), ServerAuthError);
  assert.throws(() => verifyAdminBearer('right-token', config), ServerAuthError);
  assert.throws(() => verifyAdminBearer('Bearer wrong-token', config), ServerAuthError);
});

test('verifyAdminBearer accepts the exact configured token', () => {
  const config = resolveServerAuthConfig({ CONSTRUCT_SERVER_ADMIN_TOKEN: 'right-token' });
  assert.equal(verifyAdminBearer('Bearer right-token', config), true);
});

test('verifyMemberBearer resolves a live token to its workspace/member/role', async () => {
  const sql = fakeSql([{ workspace_id: 'ws1', member_ref: 'alice', role: 'owner' }]);
  const result = await verifyMemberBearer('Bearer some-token', sql);
  assert.deepEqual(result, { workspaceId: 'ws1', memberRef: 'alice', role: 'owner' });
});

test('verifyMemberBearer rejects a missing/malformed header without querying sql', async () => {
  const sql = fakeSql([{ workspace_id: 'ws1', member_ref: 'alice', role: 'owner' }]);
  await assert.rejects(() => verifyMemberBearer(undefined, sql), ServerAuthError);
  await assert.rejects(() => verifyMemberBearer('not-a-bearer-header', sql), ServerAuthError);
  assert.equal(sql.calls.length, 0);
});

test('verifyMemberBearer rejects an unknown/revoked/orphaned-membership token with one uniform message', async () => {
  const sql = fakeSql([]);
  await assert.rejects(
    () => verifyMemberBearer('Bearer no-such-token', sql),
    (err) => err instanceof ServerAuthError && /invalid, revoked, or no longer a workspace member/.test(err.message),
  );
});

test('requireWorkspaceAccess passes when the token workspace matches the path', () => {
  const auth = { workspaceId: 'ws1', memberRef: 'alice', role: 'member' };
  assert.deepEqual(requireWorkspaceAccess(auth, 'ws1'), auth);
});

test('requireWorkspaceAccess rejects a token scoped to a different workspace', () => {
  const auth = { workspaceId: 'ws1', memberRef: 'alice', role: 'owner' };
  assert.throws(
    () => requireWorkspaceAccess(auth, 'ws2'),
    (err) => err instanceof ServerAuthError && err.status === 403,
  );
});

test('requireWorkspaceAccess rejects a member-role token on an owner-only route', () => {
  const auth = { workspaceId: 'ws1', memberRef: 'bob', role: 'member' };
  assert.throws(
    () => requireWorkspaceAccess(auth, 'ws1', { role: 'owner' }),
    (err) => err instanceof ServerAuthError && err.status === 403,
  );
});

test('requireWorkspaceAccess allows an owner-role token on an owner-only route', () => {
  const auth = { workspaceId: 'ws1', memberRef: 'carol', role: 'owner' };
  assert.deepEqual(requireWorkspaceAccess(auth, 'ws1', { role: 'owner' }), auth);
});
