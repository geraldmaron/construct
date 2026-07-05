/**
 * lib/mcp/transport/http.mjs — http-remote MCP entrypoint (opt-in, fail-closed).
 *
 * The network transport. Every guard the stdio path does not need lives here,
 * applied in order per request before the MCP SDK transport ever sees the body:
 *
 *   1. Host allowlist   — DNS-rebinding defense (a rebound name still carries
 *                         the attacker's Host).
 *   2. Origin allowlist — DNS-rebinding defense for browser callers.
 *   3. Bearer + audience — RFC 8707 resource-indicator binding; a token for a
 *                         different audience is rejected.
 *   4. Scoped-context mint — the broker actor context is derived from verified
 *                         claims; the inbound token is dropped and never
 *                         forwarded downstream (token passthrough impossible).
 *
 * Startup itself fails closed: constructHttpServer resolves the auth config
 * first (resolveHttpAuthConfig throws HttpAuthConfigError on any missing field)
 * and binds to localhost by default. TLS is expected to be terminated by a
 * reverse proxy in front of this server; the localhost bind default keeps the
 * cleartext hop on the loopback interface. See docs follow-up in the bead.
 *
 * authorizeHttpRequest is the pure decision function — headers in, a decision
 * or a thrown HttpAuthError out — so the whole authorization pipeline is
 * unit-testable without opening a socket. startHttpTransport wires it to a
 * real node:http server only at the entrypoint.
 */

import http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  resolveHttpAuthConfig,
  validateOrigin,
  validateHost,
  verifyBearer,
  mintScopedContext,
  HttpAuthError,
} from './auth.mjs';

/**
 * Resolve config and refuse to continue if auth is unconfigured. Callers that
 * want to know whether http mode CAN start call this and catch
 * HttpAuthConfigError; the http entrypoint calls it before binding a socket.
 */
export function constructHttpServer(env = process.env) {
  return resolveHttpAuthConfig(env);
}

/**
 * Decide whether a single inbound HTTP request may reach tool dispatch. Runs
 * the four guards in order and throws HttpAuthError (with a 401/403 status) on
 * the first failure. On success returns { context } — the scoped internal actor
 * context minted from verified claims, with NO token field.
 *
 * @param {object} headers - lowercased request headers (host, origin, authorization)
 * @param {object} config  - the frozen config from resolveHttpAuthConfig
 */
export function authorizeHttpRequest(headers, config, { now = () => Date.now() } = {}) {
  const host = headers.host ?? headers.Host;
  if (!validateHost(host, config)) {
    throw new HttpAuthError(`host not allowed: ${JSON.stringify(host)}`, { status: 421 });
  }

  const origin = headers.origin ?? headers.Origin;
  if (!validateOrigin(origin, config)) {
    throw new HttpAuthError(`origin not allowed: ${JSON.stringify(origin)}`, { status: 403 });
  }

  const authHeader = headers.authorization ?? headers.Authorization;
  const claims = verifyBearer(authHeader, config, { now });

  const context = mintScopedContext(claims, config, { now });
  return { context };
}

// The WWW-Authenticate challenge names the resource metadata location per the
// MCP authorization guidance so a compliant client can discover how to obtain
// a correctly-scoped token instead of guessing.

function writeAuthError(res, err, config) {
  const status = err instanceof HttpAuthError ? err.status : 401;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  if (status === 401) {
    res.setHeader('WWW-Authenticate', `Bearer realm="construct-mcp", audience="${config.audience}"`);
  }
  res.end(JSON.stringify({ error: err.message }));
}

/**
 * Start a real http-remote MCP server bound to localhost by default. Fails
 * closed at the first line: a missing auth config throws before listen().
 * Returns { server, transport, config } once listening.
 *
 * Each request is authorized by authorizeHttpRequest first; only an authorized
 * request is handed to the SDK transport, and the scoped context (never the
 * token) is attached for the dispatch layer to read.
 */
export async function startHttpTransport(mcpServer, { env = process.env } = {}) {
  const config = resolveHttpAuthConfig(env);

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcpServer.connect(transport);

  const httpServer = http.createServer(async (req, res) => {
    let decision;
    try {
      decision = authorizeHttpRequest(req.headers, config);
    } catch (err) {
      writeAuthError(res, err, config);
      return;
    }

    // The verified, token-free scoped context rides on the request object for
    // the dispatch layer; the raw Authorization header is stripped here, so
    // nothing downstream can forward the inbound credential.

    req.constructScopedContext = decision.context;
    delete req.headers.authorization;
    delete req.headers.Authorization;

    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err?.message || 'internal error' }));
      }
    }
  });

  await new Promise((resolveListen) => {
    httpServer.listen(config.bindPort, config.bindHost, resolveListen);
  });

  return { server: httpServer, transport, config };
}
