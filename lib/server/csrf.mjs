/**
 * lib/server/csrf.mjs — double-submit CSRF protection for state-mutating routes.
 *
 * Every non-GET request must include a `X-Construct-Csrf` header whose value
 * matches the `cx_csrf` cookie. The dashboard mints the cookie on first
 * authenticated load (the cookie value is a 256-bit random hex string,
 * SameSite=Lax, HttpOnly=false so the SPA can read it). Issuing the header
 * proves the request originated from a page that received the cookie, which
 * a cross-origin attacker cannot forge.
 *
 * Routes that legitimately accept unauthenticated requests (webhooks,
 * /api/auth/login) opt out by passing `{ skipMethods: ['POST'] }` or by
 * checking `csrfRequired(url)` themselves.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'cx_csrf';
const HEADER_NAME = 'x-construct-csrf';
const TOKEN_BYTES = 32;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.split('=');
    if (!k) continue;
    out[k.trim()] = rest.join('=').trim();
  }
  return out;
}

function bufFromHex(s) {
  if (typeof s !== 'string' || s.length % 2 !== 0) return null;
  try { return Buffer.from(s, 'hex'); } catch { return null; }
}

export function mintCsrfToken() {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

/**
 * Ensure the response has the `cx_csrf` cookie. If the request already had
 * one, leave it alone. Otherwise mint and set it.
 *
 * @returns {string} the token now in play
 */
export function ensureCsrfCookie(req, res) {
  const existing = parseCookies(req)[COOKIE_NAME];
  if (existing) return existing;
  const token = mintCsrfToken();
  const sec = req.socket?.encrypted ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; SameSite=Lax; Max-Age=43200${sec}`
  );
  return token;
}

/**
 * Verify the `X-Construct-Csrf` header matches the `cx_csrf` cookie. Returns
 * true on safe methods (GET/HEAD/OPTIONS) without checking. Returns true on
 * URLs that opt out via `skip(url)`.
 */
export function verifyCsrf(req, { skip } = {}) {
  if (SAFE_METHODS.has(req.method)) return true;
  // A request authenticated by an Authorization header (bearer token) is not
  // cookie-driven, so it cannot be forged cross-origin — CSRF defends ambient
  // cookie auth, not header tokens. This is what lets programmatic API clients
  // (editor adapters, CLI, CI) POST without the browser CSRF dance.
  if (req.headers && req.headers.authorization) return true;
  if (typeof skip === 'function' && skip(req.url || '')) return true;
  const headerVal = req.headers[HEADER_NAME];
  const cookieVal = parseCookies(req)[COOKIE_NAME];
  if (!headerVal || !cookieVal) return false;
  if (headerVal.length !== cookieVal.length) return false;
  const a = bufFromHex(headerVal);
  const b = bufFromHex(cookieVal);
  if (!a || !b || a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

/**
 * Default skip predicate — webhooks, auth/login, and the orchestration API
 * legitimately accept POSTs without the CSRF dance. CSRF defends a browser
 * cookie session; the `/api/orchestration/*` endpoints are consumed only by
 * programmatic clients (the `--remote` CLI, the MCP tool, editor adapters) that
 * carry a bearer token (or nothing in no-token mode), never the dashboard
 * cookie — so CSRF is the wrong control there, and the auth gate still protects
 * them in token mode. Without this, a no-token daemon rejects every orchestration
 * run with a 403.
 */
export function defaultSkip(url) {
  if (!url) return false;
  return (
    url.startsWith('/api/webhooks/') ||
    url.startsWith('/api/orchestration/') ||
    url === '/api/auth/login' ||
    url === '/api/slack/commands'
  );
}
