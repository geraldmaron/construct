/**
 * lib/server/cors.mjs — origin allowlist for the dashboard server.
 *
 * The default is exact-match against the dashboard's own origin (single-host
 * self-hosted install). Operators can pass extra origins via the env var
 * `CONSTRUCT_DASHBOARD_ORIGINS` as a comma-separated list.
 *
 *   CONSTRUCT_DASHBOARD_ORIGINS="https://my-laptop.tail-net.ts.net,https://construct.example.com"
 *
 * Wildcard origins are NOT supported. `Access-Control-Allow-Origin: *` is
 * never set — paid deployments behind a private network or behind an ALB
 * with a CloudFront distribution declare exactly which origins may issue
 * requests.
 *
 * Exports:
 *   - applyCors(req, res, opts)  : sets the right Access-Control-* headers
 *                                   on a request. Returns true when the
 *                                   request was a preflight (OPTIONS) and
 *                                   the caller should respond with 204.
 *   - originAllowed(req, opts)   : true/false. Useful when middleware wants
 *                                   to enforce same-origin without setting
 *                                   any headers (e.g. on SSE streams).
 */

const HEADER_NAME = 'access-control-allow-origin';

function parseOrigins(env) {
  const list = (env.CONSTRUCT_DASHBOARD_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(list);
}

function selfOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return null;
  return `${proto}://${host}`;
}

export function originAllowed(req, { env = process.env } = {}) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const allowed = parseOrigins(env);
  allowed.add(selfOrigin(req));
  return allowed.has(origin);
}

/**
 * Set CORS headers on a response. Returns `true` for preflight requests
 * that the caller should answer with 204 immediately.
 */
export function applyCors(req, res, { env = process.env } = {}) {
  const origin = req.headers.origin;
  if (origin && originAllowed(req, { env })) {
    res.setHeader(HEADER_NAME, origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Construct-Csrf, X-Construct-Token'
    );
  }
  if (req.method === 'OPTIONS') {
    if (origin && !originAllowed(req, { env })) {
      res.statusCode = 403;
      res.end('origin not allowed');
      return true;
    }
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}
