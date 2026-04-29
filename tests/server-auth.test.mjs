/**
 * tests/server-auth.test.mjs — Unit tests for lib/server/auth.mjs.
 *
 * Tests token management, session lifecycle, cookie helpers, and the
 * isAuthenticated middleware under open (no-token) and protected modes.
 * Uses a tmp dir for the config.env file to avoid touching ~/.construct.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

// ── Fixture helpers ────────────────────────────────────────────────────────

function makeTmpHome() {
  const dir = join(tmpdir(), `cx-auth-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(join(dir, '.construct'), { recursive: true });
  return dir;
}

async function loadAuth(homeOverride) {
  // Re-import with HOME patched via env. auth.mjs reads HOME at module level
  // so we patch process.env.HOME before dynamic import to isolate each test.
  const prev = process.env.HOME;
  process.env.HOME = homeOverride;
  // Bust module cache by appending a unique query string
  const mod = await import(`../lib/server/auth.mjs?h=${randomBytes(4).toString('hex')}`);
  process.env.HOME = prev;
  return mod;
}

// ── Token management ───────────────────────────────────────────────────────

test('generateToken returns a 64-char hex string', async () => {
  const home = makeTmpHome();
  const { generateToken } = await loadAuth(home);
  const token = generateToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  rmSync(home, { recursive: true });
});

test('getDashboardToken returns null when config.env is absent', async () => {
  const home = makeTmpHome();
  const { getDashboardToken } = await loadAuth(home);
  assert.equal(getDashboardToken(), null);
  rmSync(home, { recursive: true });
});

test('setDashboardToken writes token and getDashboardToken reads it back', async () => {
  const home = makeTmpHome();
  const { setDashboardToken, getDashboardToken, generateToken } = await loadAuth(home);
  const token = generateToken();
  setDashboardToken(token);
  const configPath = join(home, '.construct', 'config.env');
  assert.ok(existsSync(configPath), 'config.env should be created');
  assert.equal(getDashboardToken(), token);
  rmSync(home, { recursive: true });
});

test('setDashboardToken replaces an existing token without duplicating the line', async () => {
  const home = makeTmpHome();
  const configPath = join(home, '.construct', 'config.env');
  writeFileSync(configPath, 'CONSTRUCT_DASHBOARD_TOKEN=old\nOTHER=val\n');
  const { setDashboardToken, getDashboardToken, generateToken } = await loadAuth(home);
  const token = generateToken();
  setDashboardToken(token);
  const content = (await import('node:fs')).readFileSync(configPath, 'utf8');
  assert.equal(content.match(/CONSTRUCT_DASHBOARD_TOKEN=/g)?.length, 1, 'should have exactly one token line');
  assert.equal(getDashboardToken(), token);
  rmSync(home, { recursive: true });
});

// ── validateToken ──────────────────────────────────────────────────────────

test('validateToken returns true when no token configured (open mode)', async () => {
  const home = makeTmpHome();
  const { validateToken } = await loadAuth(home);
  assert.ok(validateToken(null));
  assert.ok(validateToken('anything'));
  rmSync(home, { recursive: true });
});

test('validateToken returns true for correct token', async () => {
  const home = makeTmpHome();
  const { setDashboardToken, validateToken, generateToken } = await loadAuth(home);
  const token = generateToken();
  setDashboardToken(token);
  assert.ok(validateToken(token));
  rmSync(home, { recursive: true });
});

test('validateToken returns false for wrong token', async () => {
  const home = makeTmpHome();
  const { setDashboardToken, validateToken, generateToken } = await loadAuth(home);
  const token = generateToken();
  setDashboardToken(token);
  assert.ok(!validateToken('wrong'));
  assert.ok(!validateToken(null));
  assert.ok(!validateToken(''));
  rmSync(home, { recursive: true });
});

// ── Session lifecycle ──────────────────────────────────────────────────────

test('createSession returns a hex token and validateSession accepts it', async () => {
  const home = makeTmpHome();
  const { createSession, sessionCookieHeader, validateSession } = await loadAuth(home);
  const session = createSession();
  assert.match(session, /^[0-9a-f]{64}$/);
  const cookieHeader = `cx_session=${session}; other=val`;
  assert.ok(validateSession(cookieHeader));
  rmSync(home, { recursive: true });
});

test('validateSession returns false for unknown token', async () => {
  const home = makeTmpHome();
  const { validateSession } = await loadAuth(home);
  assert.ok(!validateSession('cx_session=unknowntoken'));
  assert.ok(!validateSession(undefined));
  rmSync(home, { recursive: true });
});

// ── Cookie headers ─────────────────────────────────────────────────────────

test('sessionCookieHeader includes HttpOnly and SameSite=Strict', async () => {
  const home = makeTmpHome();
  const { sessionCookieHeader } = await loadAuth(home);
  const header = sessionCookieHeader('tok');
  assert.ok(header.includes('HttpOnly'));
  assert.ok(header.includes('SameSite=Strict'));
  assert.ok(header.includes('cx_session=tok'));
  rmSync(home, { recursive: true });
});

test('clearSessionCookieHeader sets Max-Age=0', async () => {
  const home = makeTmpHome();
  const { clearSessionCookieHeader } = await loadAuth(home);
  const header = clearSessionCookieHeader();
  assert.ok(header.includes('Max-Age=0'));
  rmSync(home, { recursive: true });
});

// ── isAuthenticated middleware ─────────────────────────────────────────────

test('isAuthenticated returns true when auth not configured', async () => {
  const home = makeTmpHome();
  const { isAuthenticated } = await loadAuth(home);
  const fakeReq = { headers: {} };
  assert.ok(isAuthenticated(fakeReq));
  rmSync(home, { recursive: true });
});

test('isAuthenticated returns true with valid Bearer token', async () => {
  const home = makeTmpHome();
  const { setDashboardToken, generateToken, isAuthenticated } = await loadAuth(home);
  const token = generateToken();
  setDashboardToken(token);
  const req = { headers: { authorization: `Bearer ${token}` } };
  assert.ok(isAuthenticated(req));
  rmSync(home, { recursive: true });
});

test('isAuthenticated returns false with invalid Bearer token', async () => {
  const home = makeTmpHome();
  const { setDashboardToken, generateToken, isAuthenticated } = await loadAuth(home);
  setDashboardToken(generateToken());
  const req = { headers: { authorization: 'Bearer wrongtoken' } };
  assert.ok(!isAuthenticated(req));
  rmSync(home, { recursive: true });
});

test('isAuthenticated returns true with valid session cookie', async () => {
  const home = makeTmpHome();
  const { setDashboardToken, generateToken, isAuthenticated, createSession } = await loadAuth(home);
  const token = generateToken();
  setDashboardToken(token);
  const session = createSession();
  const req = { headers: { cookie: `cx_session=${session}` } };
  assert.ok(isAuthenticated(req));
  rmSync(home, { recursive: true });
});

test('isAuthConfigured returns false when no token set', async () => {
  const home = makeTmpHome();
  const { isAuthConfigured } = await loadAuth(home);
  assert.ok(!isAuthConfigured());
  rmSync(home, { recursive: true });
});

test('isAuthConfigured returns true after token is set', async () => {
  const home = makeTmpHome();
  const { isAuthConfigured, setDashboardToken, generateToken } = await loadAuth(home);
  setDashboardToken(generateToken());
  assert.ok(isAuthConfigured());
  rmSync(home, { recursive: true });
});
