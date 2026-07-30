/**
 * lib/server/auth.mjs — bearer-token auth for the shared workspace server
 * (E7; design doc synthesis/shared-server-design.md §2).
 *
 * Ties to construct_workspace_members, not a parallel authorization system: a
 * token resolves to exactly one (workspace_id, member_ref) row and grants no
 * authority beyond that row's `role`. Verification re-joins the live
 * membership table on every call rather than caching, so a removeMember call
 * takes effect on the very next request even if the caller's token is still
 * technically unexpired (design doc §2.1). Only the sha256 hash of a token is
 * ever persisted (construct_server_tokens.token_hash) — the raw value is
 * returned to the caller exactly once, at mint time, and never stored.
 *
 * Pure, network-free functions the http entrypoint composes at request time,
 * mirroring lib/mcp/transport/auth.mjs's split (auth logic unit-testable
 * without a socket; http.mjs only wires it to node:http).
 */

import crypto from 'node:crypto';

export class ServerAuthError extends Error {
  constructor(message, { status = 401 } = {}) {
    super(message);
    this.name = 'ServerAuthError';
    this.status = status;
  }
}

export class ServerAuthConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ServerAuthConfigError';
  }
}

/**
 * Resolve the operator-secret half of auth (workspace bootstrap only, design
 * doc §2.2). Does not throw: a server with no admin token configured still
 * starts and serves every member-token-authorized route; only
 * POST /workspaces is permanently disabled (501), never silently open.
 */
export function resolveServerAuthConfig(env = process.env) {
  const adminToken = String(env.CONSTRUCT_SERVER_ADMIN_TOKEN || '').trim();
  return Object.freeze({
    adminTokenConfigured: adminToken.length > 0,
    adminToken: adminToken || null,
  });
}

export function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

export function mintRawToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Verify the admin token from an Authorization: Bearer header against the
 * configured operator secret (constant-time compare). Throws
 * ServerAuthConfigError (501-equivalent — the caller maps it) if no admin
 * token is configured at all, ServerAuthError (401) if the header is missing/
 * malformed/mismatched.
 */
export function verifyAdminBearer(rawAuthHeader, config) {
  if (!config.adminTokenConfigured) {
    throw new ServerAuthConfigError('workspace bootstrap is disabled: CONSTRUCT_SERVER_ADMIN_TOKEN is not configured on this server');
  }
  if (typeof rawAuthHeader !== 'string' || !rawAuthHeader.startsWith('Bearer ')) {
    throw new ServerAuthError('missing or malformed Authorization: Bearer header');
  }
  const token = rawAuthHeader.slice('Bearer '.length).trim();
  if (!timingSafeEqualStr(token, config.adminToken)) {
    throw new ServerAuthError('admin token does not verify');
  }
  return true;
}

/**
 * Issue a member token: insert its hash, return the raw token once. Callers
 * must persist/display the raw value immediately — the store never retains
 * the plaintext, so it cannot be recovered on a later call.
 */
export async function issueToken(sql, { workspaceId, memberRef }) {
  if (!workspaceId) throw new Error('issueToken: workspaceId is required');
  if (!memberRef) throw new Error('issueToken: memberRef is required');
  const raw = mintRawToken();
  const hash = hashToken(raw);
  await sql`
    INSERT INTO construct_server_tokens (token_hash, workspace_id, member_ref)
    VALUES (${hash}, ${workspaceId}, ${memberRef})
  `;
  return raw;
}

export async function revokeToken(sql, rawToken) {
  const hash = hashToken(rawToken);
  const rows = await sql`
    UPDATE construct_server_tokens SET revoked_at = now()
    WHERE token_hash = ${hash} AND revoked_at IS NULL
    RETURNING token_hash
  `;
  return rows.length > 0;
}

export async function revokeMemberTokens(sql, workspaceId, memberRef) {
  const rows = await sql`
    UPDATE construct_server_tokens SET revoked_at = now()
    WHERE workspace_id = ${workspaceId} AND member_ref = ${memberRef} AND revoked_at IS NULL
    RETURNING token_hash
  `;
  return rows.length;
}

/**
 * Resolve a bearer token to { workspaceId, memberRef, role }. Rejects (throws
 * ServerAuthError, 401) on a missing/malformed header, an unknown or revoked
 * token, or a token whose membership row is absent — deliberately the same
 * message for all three (design doc §2.4 step 2: do not distinguish "bad
 * token" from "revoked token" in the response).
 */
export async function verifyMemberBearer(rawAuthHeader, sql) {
  if (typeof rawAuthHeader !== 'string' || !rawAuthHeader.startsWith('Bearer ')) {
    throw new ServerAuthError('missing or malformed Authorization: Bearer header');
  }
  const token = rawAuthHeader.slice('Bearer '.length).trim();
  const hash = hashToken(token);
  const rows = await sql`
    SELECT t.workspace_id, t.member_ref, m.role
    FROM construct_server_tokens t
    JOIN construct_workspace_members m
      ON m.workspace_id = t.workspace_id AND m.member_ref = t.member_ref
    WHERE t.token_hash = ${hash} AND t.revoked_at IS NULL
  `;
  const row = rows[0];
  if (!row) throw new ServerAuthError('bearer token is invalid, revoked, or no longer a workspace member');
  return { workspaceId: row.workspace_id, memberRef: row.member_ref, role: row.role };
}

/**
 * Assert the authorized caller's workspace matches the path's :id and (when
 * required) holds the 'owner' role. Throws ServerAuthError(403) on either
 * mismatch — a valid token for workspace A can never reach workspace B's data
 * (design doc §2.4 step 5), and a member-role token can never reach an
 * owner-only route (step 4).
 */
export function requireWorkspaceAccess(auth, pathWorkspaceId, { role } = {}) {
  if (auth.workspaceId !== pathWorkspaceId) {
    throw new ServerAuthError('token is not authorized for this workspace', { status: 403 });
  }
  if (role && auth.role !== role) {
    throw new ServerAuthError(`this action requires the '${role}' role`, { status: 403 });
  }
  return auth;
}
