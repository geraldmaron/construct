/**
 * lib/server/auth.mjs — Dashboard authentication middleware.
 *
 * Token-based auth for the Construct dashboard. A single shared bearer token
 * is stored at ~/.construct/config.env under CONSTRUCT_DASHBOARD_TOKEN. If no
 * token is configured the dashboard runs open (localhost-only by design). The
 * browser receives a short-lived session cookie on successful token exchange so
 * subsequent requests don't need to re-send the Authorization header.
 *
 * API routes check: Authorization: Bearer <token>  OR  session cookie.
 * The login page POSTs to /api/auth/login and receives a Set-Cookie response.
 * GET /api/auth/status returns { configured, authenticated }.
 */

import { randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const CONFIG_ENV = join(HOME, '.construct', 'config.env');
const SESSION_COOKIE = 'cx_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// ── In-memory session store ────────────────────────────────────────────────
// Sessions are ephemeral — cleared on server restart. Acceptable for a local
// single-user dashboard; no persistence needed.
const sessions = new Map(); // token → { expiresAt }

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

// ── Token management ───────────────────────────────────────────────────────

export function getDashboardToken() {
  const env = parseEnvFile(CONFIG_ENV);
  return env.CONSTRUCT_DASHBOARD_TOKEN || null;
}

export function setDashboardToken(token) {
  mkdirSync(join(HOME, '.construct'), { recursive: true });
  const env = existsSync(CONFIG_ENV) ? readFileSync(CONFIG_ENV, 'utf8') : '';
  const lines = env.split('\n').filter(l => !l.startsWith('CONSTRUCT_DASHBOARD_TOKEN='));
  lines.push(`CONSTRUCT_DASHBOARD_TOKEN=${token}`);
  writeFileSync(CONFIG_ENV, lines.filter(Boolean).join('\n') + '\n', 'utf8');
}

export function generateToken() {
  return randomBytes(32).toString('hex');
}

// ── Auth state ─────────────────────────────────────────────────────────────

export function isAuthConfigured() {
  return Boolean(getDashboardToken());
}

function safeCompare(a, b) {
  try {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) {
      // Still run the comparison to avoid timing leak
      timingSafeEqual(ab, Buffer.alloc(ab.length));
      return false;
    }
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

export function validateToken(candidate) {
  const stored = getDashboardToken();
  if (!stored) return true; // No token configured → open
  if (!candidate) return false;
  return safeCompare(candidate, stored);
}

// ── Session cookie helpers ─────────────────────────────────────────────────

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k) out[k.trim()] = rest.join('=').trim();
  }
  return out;
}

export function createSession() {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export function validateSession(cookieHeader) {
  const cookies = parseCookies(cookieHeader);
  const token = cookies[SESSION_COOKIE];
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) { sessions.delete(token); return false; }
  return true;
}

export function sessionCookieHeader(token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Path=/`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/`;
}

// ── Middleware ─────────────────────────────────────────────────────────────

/**
 * Returns true if the request is authenticated (or auth is not configured).
 * Checks: session cookie first, then Authorization: Bearer header.
 */
export function isAuthenticated(req) {
  if (!isAuthConfigured()) return true;
  if (validateSession(req.headers.cookie)) return true;
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  return validateToken(bearer);
}

/**
 * Send a 401 JSON response.
 */
export function rejectUnauthorized(res) {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized', hint: 'Set Authorization: Bearer <CONSTRUCT_DASHBOARD_TOKEN>' }));
}
