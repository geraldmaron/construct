/**
 * lib/server/http.mjs — the shared workspace server's HTTP surface
 * (construct-b0nny.26, E7; design doc synthesis/shared-server-design.md §5).
 *
 * A plain node:http server (ADR-0001 keeps npm out of core, following lib/
 * org-studio/server.mjs's and lib/mcp/transport/http.mjs's precedent — no
 * framework, no build step). Routes are workspace-scoped by path
 * (/workspaces/:id/...); every authorized request's token is checked against
 * the path's :id (lib/server/auth.mjs's requireWorkspaceAccess) so a valid
 * token for one workspace can never reach another's data. Binds to loopback
 * by default; a real deployment terminates TLS at a reverse proxy in front,
 * the same posture lib/mcp/transport/http.mjs documents.
 *
 * Purely additive: nothing here is imported by any solo-mode code path, and
 * starting this server requires an explicit `construct server start`
 * invocation with a reachable Postgres DATABASE_URL.
 */

import http from 'node:http';

import { PostgresWorkspaceStore } from '../workspace/postgres-store.mjs';
import { PostgresIntakeQueue } from '../queue/pg-queue.mjs';
import { WorkerRegistry } from '../orchestration/worker-runtime.mjs';
import { probeSqlClient } from '../storage/backend.mjs';
import {
  resolveServerAuthConfig, verifyAdminBearer, verifyMemberBearer, requireWorkspaceAccess,
  issueToken, revokeMemberTokens, ServerAuthError, ServerAuthConfigError,
} from './auth.mjs';

const MAX_BODY_BYTES = 1 * 1024 * 1024;
export const QUEUE_NAME = 'assignments';
export const TENANT_ID = 'shared';

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('request body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function matchRoute(method, pathname, routes) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(pathname);
    if (match) return { route, params: match.groups || {} };
  }
  return null;
}

/**
 * Build the route table bound to one sql client. Split from startServer so
 * the routing/handler logic is reachable without a real socket (unit tests
 * can call handlers directly via a fake req/res if ever needed), matching
 * the pure-function-first shape lib/mcp/transport/auth.mjs established.
 */
export function buildRoutes(sql) {
  const workspaces = new PostgresWorkspaceStore({ sql });

  function queueFor(workspaceId) {
    return new PostgresIntakeQueue({ sql, project: workspaceId, tenantId: TENANT_ID, queueName: QUEUE_NAME });
  }

  function workersFor(workspaceId) {
    return new WorkerRegistry({ sql, project: workspaceId, tenantId: TENANT_ID });
  }

  return [
    {
      method: 'GET',
      pattern: /^\/healthz$/,
      auth: 'none',
      handler: async () => ({ status: 200, body: { ok: true } }),
    },
    {
      method: 'GET',
      pattern: /^\/readyz$/,
      auth: 'none',
      handler: async () => {
        const probe = await probeSqlClient(sql);
        return { status: probe.status === 'available' ? 200 : 503, body: probe };
      },
    },
    {
      method: 'POST',
      pattern: /^\/workspaces$/,
      auth: 'admin',
      handler: async ({ body, admin }) => {
        const { id, name, rootPath, remote, deployment, ownerRef } = body || {};
        if (!id) return { status: 400, body: { error: 'id is required' } };
        if (!ownerRef) return { status: 400, body: { error: 'ownerRef is required' } };
        await workspaces.ensureSchema();
        const workspace = await workspaces.createWorkspace(id, { name, rootPath, remote, deployment });
        await workspaces.addMember(id, ownerRef, { role: 'owner' });
        const token = await issueToken(sql, { workspaceId: id, memberRef: ownerRef });
        return { status: 201, body: { workspace, ownerRef, token } };
      },
    },
    {
      method: 'GET',
      pattern: /^\/workspaces\/(?<id>[^/]+)$/,
      auth: 'member',
      handler: async ({ params, auth }) => {
        requireWorkspaceAccess(auth, params.id);
        const workspace = await workspaces.getWorkspace(params.id);
        if (!workspace) return { status: 404, body: { error: 'workspace not found' } };
        return { status: 200, body: { workspace } };
      },
    },
    {
      method: 'POST',
      pattern: /^\/workspaces\/(?<id>[^/]+)\/activate$/,
      auth: 'member',
      handler: async ({ params, auth }) => {
        requireWorkspaceAccess(auth, params.id, { role: 'owner' });
        const workspace = await workspaces.activateWorkspace(params.id);
        return { status: 200, body: { workspace } };
      },
    },
    {
      method: 'POST',
      pattern: /^\/workspaces\/(?<id>[^/]+)\/archive$/,
      auth: 'member',
      handler: async ({ params, auth }) => {
        requireWorkspaceAccess(auth, params.id, { role: 'owner' });
        const workspace = await workspaces.archiveWorkspace(params.id);
        return { status: 200, body: { workspace } };
      },
    },
    {
      method: 'POST',
      pattern: /^\/workspaces\/(?<id>[^/]+)\/members$/,
      auth: 'member',
      handler: async ({ params, auth, body }) => {
        requireWorkspaceAccess(auth, params.id, { role: 'owner' });
        const { memberRef, role } = body || {};
        if (!memberRef) return { status: 400, body: { error: 'memberRef is required' } };
        const member = await workspaces.addMember(params.id, memberRef, { role: role || 'member' });
        const token = await issueToken(sql, { workspaceId: params.id, memberRef });
        return { status: 201, body: { member, token } };
      },
    },
    {
      method: 'GET',
      pattern: /^\/workspaces\/(?<id>[^/]+)\/members$/,
      auth: 'member',
      handler: async ({ params, auth }) => {
        requireWorkspaceAccess(auth, params.id);
        return { status: 200, body: { members: await workspaces.listMembers(params.id) } };
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/workspaces\/(?<id>[^/]+)\/members\/(?<memberRef>[^/]+)$/,
      auth: 'member',
      handler: async ({ params, auth }) => {
        requireWorkspaceAccess(auth, params.id, { role: 'owner' });
        await workspaces.removeMember(params.id, params.memberRef);
        await revokeMemberTokens(sql, params.id, params.memberRef);
        return { status: 200, body: { removed: true } };
      },
    },
    {
      method: 'GET',
      pattern: /^\/workspaces\/(?<id>[^/]+)\/settings$/,
      auth: 'member',
      handler: async ({ params, auth }) => {
        requireWorkspaceAccess(auth, params.id);
        return { status: 200, body: { settings: await workspaces.getSettings(params.id) } };
      },
    },
    {
      method: 'PUT',
      pattern: /^\/workspaces\/(?<id>[^/]+)\/settings$/,
      auth: 'member',
      handler: async ({ params, auth, body }) => {
        requireWorkspaceAccess(auth, params.id, { role: 'owner' });
        const { key, value } = body || {};
        if (!key) return { status: 400, body: { error: 'key is required' } };
        const settings = await workspaces.setSetting(params.id, key, value);
        return { status: 200, body: { settings } };
      },
    },
    {
      method: 'POST',
      pattern: /^\/workspaces\/(?<id>[^/]+)\/work$/,
      auth: 'member',
      handler: async ({ params, auth, body }) => {
        requireWorkspaceAccess(auth, params.id);
        const queue = queueFor(params.id);
        await queue.ensureSchema();
        const entry = await queue.enqueue(body);
        return { status: 201, body: entry };
      },
    },
    {
      method: 'POST',
      pattern: /^\/workspaces\/(?<id>[^/]+)\/work\/claim$/,
      auth: 'member',
      handler: async ({ params, auth, body }) => {
        requireWorkspaceAccess(auth, params.id);
        const queue = queueFor(params.id);
        await queue.ensureSchema();
        const claimedBy = body?.claimedBy || auth.memberRef;
        const claimed = await queue.claim({ claimedBy, leaseSeconds: body?.leaseSeconds });
        return { status: claimed ? 200 : 204, body: claimed || null };
      },
    },
    {
      method: 'POST',
      pattern: /^\/workspaces\/(?<id>[^/]+)\/work\/(?<itemId>[^/]+)\/heartbeat$/,
      auth: 'member',
      handler: async ({ params, auth, body }) => {
        requireWorkspaceAccess(auth, params.id);
        const queue = queueFor(params.id);
        await queue.ensureSchema();
        const workerId = body?.workerId || auth.memberRef;
        const result = await queue.heartbeat(params.itemId, { workerId, leaseSeconds: body?.leaseSeconds });
        return { status: 200, body: result };
      },
    },
    {
      method: 'POST',
      pattern: /^\/workspaces\/(?<id>[^/]+)\/work\/(?<itemId>[^/]+)\/complete$/,
      auth: 'member',
      handler: async ({ params, auth, body }) => {
        requireWorkspaceAccess(auth, params.id);
        const queue = queueFor(params.id);
        await queue.ensureSchema();
        const processedBy = body?.processedBy || auth.memberRef;
        const result = await queue.markProcessed(params.itemId, { processedBy, notes: body?.notes, executionKey: body?.executionKey });
        return { status: result ? 200 : 409, body: result || { error: 'item already processed or not claimed' } };
      },
    },
    {
      method: 'POST',
      pattern: /^\/workspaces\/(?<id>[^/]+)\/work\/(?<itemId>[^/]+)\/fail$/,
      auth: 'member',
      handler: async ({ params, auth, body }) => {
        requireWorkspaceAccess(auth, params.id);
        const queue = queueFor(params.id);
        await queue.ensureSchema();
        const workerId = body?.workerId || auth.memberRef;
        const result = await queue.fail(params.itemId, { workerId, reason: body?.reason, backoffSeconds: body?.backoffSeconds });
        return { status: result ? 200 : 409, body: result || { error: 'item was not claimed by this worker' } };
      },
    },
    {
      method: 'GET',
      pattern: /^\/workspaces\/(?<id>[^/]+)\/work\/stats$/,
      auth: 'member',
      handler: async ({ params, auth }) => {
        requireWorkspaceAccess(auth, params.id);
        const queue = queueFor(params.id);
        await queue.ensureSchema();
        return { status: 200, body: await queue.queueStats() };
      },
    },
    {
      method: 'POST',
      pattern: /^\/workspaces\/(?<id>[^/]+)\/workers\/register$/,
      auth: 'member',
      handler: async ({ params, auth, body }) => {
        requireWorkspaceAccess(auth, params.id);
        const workers = workersFor(params.id);
        const registered = await workers.register({ workerId: body?.workerId, capabilities: body?.capabilities, ttlSeconds: body?.ttlSeconds, metadata: body?.metadata });
        return { status: 201, body: registered };
      },
    },
    {
      method: 'POST',
      pattern: /^\/workspaces\/(?<id>[^/]+)\/workers\/(?<workerId>[^/]+)\/heartbeat$/,
      auth: 'member',
      handler: async ({ params, auth, body }) => {
        requireWorkspaceAccess(auth, params.id);
        const workers = workersFor(params.id);
        const result = await workers.heartbeat(params.workerId, { ttlSeconds: body?.ttlSeconds });
        return { status: 200, body: result };
      },
    },
    {
      method: 'GET',
      pattern: /^\/workspaces\/(?<id>[^/]+)\/workers$/,
      auth: 'member',
      handler: async ({ params, auth }) => {
        requireWorkspaceAccess(auth, params.id);
        const workers = workersFor(params.id);
        return { status: 200, body: { workers: await workers.list() } };
      },
    },
  ];
}

async function dispatch(req, res, routes, { sql, authConfig }) {
  const url = new URL(req.url, 'http://internal');
  const match = matchRoute(req.method, url.pathname, routes);
  if (!match) return sendJson(res, 404, { error: 'not found' });

  const { route, params } = match;
  try {
    let auth = null;
    let admin = false;
    if (route.auth === 'admin') {
      verifyAdminBearer(req.headers.authorization, authConfig);
      admin = true;
    } else if (route.auth === 'member') {
      auth = await verifyMemberBearer(req.headers.authorization, sql);
    }

    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const result = await route.handler({ params, body, auth, admin, query: url.searchParams });
    return sendJson(res, result.status, result.body);
  } catch (err) {
    if (err instanceof ServerAuthConfigError) return sendJson(res, 501, { error: err.message });
    if (err instanceof ServerAuthError) {
      if (err.status === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="construct-server"');
      return sendJson(res, err.status, { error: err.message });
    }
    if (err?.code === 'WORKSPACE_EXISTS') return sendJson(res, 409, { error: err.message });
    if (err?.code === 'WORKSPACE_NOT_FOUND') return sendJson(res, 404, { error: err.message });
    if (err?.code === 'WORKSPACE_INVALID_TRANSITION') return sendJson(res, 409, { error: err.message });
    if (/invalid JSON body|request body too large/.test(err?.message || '')) return sendJson(res, 400, { error: err.message });
    return sendJson(res, 500, { error: err?.message || 'internal error' });
  }
}

export const DEFAULT_SERVER_HOST = '127.0.0.1';
export const DEFAULT_SERVER_PORT = 4780;

/**
 * Resolve the bind host/port from an explicit arg, then env, then the default.
 * Number(undefined) is NaN and `??` does not treat NaN as nullish, so an unset
 * CONSTRUCT_SERVER_PORT must be resolved before the Number() coercion — passing
 * NaN to server.listen throws ERR_SOCKET_BAD_PORT. Port 0 (OS-assigned) is a
 * real value and is preserved.
 */
export function resolveBindTarget({ env = process.env, host, port } = {}) {
  const envPort = env.CONSTRUCT_SERVER_PORT != null && env.CONSTRUCT_SERVER_PORT !== ''
    ? Number(env.CONSTRUCT_SERVER_PORT)
    : undefined;
  return {
    host: host ?? env.CONSTRUCT_SERVER_HOST ?? DEFAULT_SERVER_HOST,
    port: port ?? envPort ?? DEFAULT_SERVER_PORT,
  };
}

/**
 * Start the shared workspace server. Binds to loopback by default;
 * CONSTRUCT_SERVER_HOST widens it for a real container deployment (the
 * Docker Compose service binds 0.0.0.0 explicitly, see docker-compose.yml).
 * Returns { server, port } once listening.
 */
export async function startServer({ sql, env = process.env, host, port } = {}) {
  if (!sql) throw new Error('startServer: sql client is required (see lib/storage/backend.mjs createSqlClient)');
  const authConfig = resolveServerAuthConfig(env);
  const routes = buildRoutes(sql);
  const { host: bindHost, port: bindPort } = resolveBindTarget({ env, host, port });

  const server = http.createServer((req, res) => {
    dispatch(req, res, routes, { sql, authConfig }).catch((err) => {
      if (!res.headersSent) sendJson(res, 500, { error: err?.message || 'internal error' });
    });
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(bindPort, bindHost, () => resolveListen());
  });

  const address = server.address();
  return { server, host: bindHost, port: typeof address === 'object' ? address.port : bindPort };
}
