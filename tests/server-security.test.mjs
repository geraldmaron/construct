/**
 * tests/server-security.test.mjs — CSRF / CORS / rate-limit / logger tests.
 *
 * Each module is unit-tested in isolation (no live server). Wiring into the
 * dashboard server is exercised in a follow-up; this suite proves the
 * primitives are correct.
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { applyCors, originAllowed } from '../lib/server/cors.mjs';
import { ensureCsrfCookie, verifyCsrf, mintCsrfToken, defaultSkip } from '../lib/server/csrf.mjs';
import { checkRateLimit, _resetRateLimitBucketsForTests, DEFAULT_TIERS } from '../lib/server/rate-limit.mjs';
import { makeLogger, newRequestId } from '../lib/logger.mjs';

class FakeReq {
  constructor({ method = 'GET', url = '/', headers = {}, remoteAddress = '127.0.0.1' } = {}) {
    this.method = method;
    this.url = url;
    this.headers = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    );
    this.socket = { remoteAddress };
  }
}

class FakeRes {
  constructor() { this.headers = {}; this.statusCode = 0; this.ended = false; }
  setHeader(k, v) { this.headers[k.toLowerCase()] = v; }
  end(_body) { this.ended = true; }
}

describe('cors', () => {
  it('allows the dashboard origin by default', () => {
    const req = new FakeReq({ headers: { origin: 'http://localhost:8765', host: 'localhost:8765' } });
    assert.equal(originAllowed(req, { env: {} }), true);
  });

  it('rejects an origin not on the allowlist', () => {
    const req = new FakeReq({
      headers: { origin: 'http://evil.example', host: 'localhost:8765' },
    });
    assert.equal(originAllowed(req, { env: {} }), false);
  });

  it('honors CONSTRUCT_DASHBOARD_ORIGINS allowlist', () => {
    const req = new FakeReq({
      headers: { origin: 'https://dashboard.example.com', host: 'dashboard.example.com' },
    });
    assert.equal(
      originAllowed(req, { env: { CONSTRUCT_DASHBOARD_ORIGINS: 'https://dashboard.example.com' } }),
      true
    );
  });

  it('applyCors short-circuits OPTIONS preflight with 204 when origin is allowed', () => {
    const req = new FakeReq({
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:8765', host: 'localhost:8765' },
    });
    const res = new FakeRes();
    const handled = applyCors(req, res, { env: {} });
    assert.equal(handled, true);
    assert.equal(res.statusCode, 204);
    assert.equal(res.ended, true);
  });

  it('applyCors rejects OPTIONS preflight from disallowed origin with 403', () => {
    const req = new FakeReq({
      method: 'OPTIONS',
      headers: { origin: 'http://evil.example', host: 'localhost:8765' },
    });
    const res = new FakeRes();
    applyCors(req, res, { env: {} });
    assert.equal(res.statusCode, 403);
  });
});

describe('csrf', () => {
  it('passes safe methods without a token', () => {
    const req = new FakeReq({ method: 'GET' });
    assert.equal(verifyCsrf(req), true);
  });

  it('fails POST without header + cookie', () => {
    const req = new FakeReq({ method: 'POST' });
    assert.equal(verifyCsrf(req), false);
  });

  it('passes POST when header matches cookie', () => {
    const token = mintCsrfToken();
    const req = new FakeReq({
      method: 'POST',
      headers: { cookie: `cx_csrf=${token}`, 'x-construct-csrf': token },
    });
    assert.equal(verifyCsrf(req), true);
  });

  it('rejects POST when header does not match cookie', () => {
    const a = mintCsrfToken();
    const b = mintCsrfToken();
    const req = new FakeReq({
      method: 'POST',
      headers: { cookie: `cx_csrf=${a}`, 'x-construct-csrf': b },
    });
    assert.equal(verifyCsrf(req), false);
  });

  it('honors a skip predicate', () => {
    const req = new FakeReq({ method: 'POST', url: '/api/webhooks/github' });
    assert.equal(verifyCsrf(req, { skip: defaultSkip }), true);
  });

  it('ensureCsrfCookie sets a Set-Cookie header when none present', () => {
    const req = new FakeReq();
    const res = new FakeRes();
    const token = ensureCsrfCookie(req, res);
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.match(res.headers['set-cookie'], /^cx_csrf=/);
    assert.match(res.headers['set-cookie'], /SameSite=Lax/);
  });

  it('ensureCsrfCookie returns the existing cookie value unchanged', () => {
    const existing = mintCsrfToken();
    const req = new FakeReq({ headers: { cookie: `cx_csrf=${existing}` } });
    const res = new FakeRes();
    const token = ensureCsrfCookie(req, res);
    assert.equal(token, existing);
    assert.equal(res.headers['set-cookie'], undefined);
  });
});

describe('rate-limit', () => {
  beforeEach(() => _resetRateLimitBucketsForTests());

  it('allows up to capacity then denies', () => {
    const req = new FakeReq({ remoteAddress: '10.0.0.1' });
    const cap = DEFAULT_TIERS.write.capacity;
    for (let i = 0; i < cap; i++) {
      assert.equal(checkRateLimit(req, 'write', { env: {} }).allowed, true);
    }
    const denied = checkRateLimit(req, 'write', { env: {} });
    assert.equal(denied.allowed, false);
    assert.ok(denied.retryAfterMs > 0);
  });

  it('isolates buckets per IP', () => {
    const a = new FakeReq({ remoteAddress: '10.0.0.1' });
    const b = new FakeReq({ remoteAddress: '10.0.0.2' });
    for (let i = 0; i < DEFAULT_TIERS.write.capacity; i++) {
      checkRateLimit(a, 'write', { env: {} });
    }
    assert.equal(checkRateLimit(a, 'write', { env: {} }).allowed, false);
    assert.equal(checkRateLimit(b, 'write', { env: {} }).allowed, true);
  });

  it('honors CONSTRUCT_RATELIMIT_<TIER> overrides', () => {
    const req = new FakeReq({ remoteAddress: '10.0.0.3' });
    const env = { CONSTRUCT_RATELIMIT_WRITE: '2' };
    assert.equal(checkRateLimit(req, 'write', { env }).allowed, true);
    assert.equal(checkRateLimit(req, 'write', { env }).allowed, true);
    assert.equal(checkRateLimit(req, 'write', { env }).allowed, false);
  });
});

describe('logger', () => {
  it('emits JSON lines on stderr', () => {
    const captured = [];
    const stream = { write: (s) => captured.push(s) };
    const log = makeLogger({ env: { CONSTRUCT_LOG_LEVEL: 'info' }, stream });
    log.info('test.event', { foo: 'bar' });
    assert.equal(captured.length, 1);
    const parsed = JSON.parse(captured[0].trim());
    assert.equal(parsed.event, 'test.event');
    assert.equal(parsed.level, 'info');
    assert.equal(parsed.foo, 'bar');
    assert.ok(parsed.ts);
  });

  it('respects CONSTRUCT_LOG_LEVEL threshold', () => {
    const captured = [];
    const stream = { write: (s) => captured.push(s) };
    const log = makeLogger({ env: { CONSTRUCT_LOG_LEVEL: 'warn' }, stream });
    log.debug('shouldnt.appear');
    log.info('shouldnt.appear');
    log.warn('should.appear');
    log.error('should.appear');
    assert.equal(captured.length, 2);
  });

  it('child logger inherits + extends fields', () => {
    const captured = [];
    const stream = { write: (s) => captured.push(s) };
    const log = makeLogger({ env: { CONSTRUCT_LOG_LEVEL: 'info' }, stream });
    const reqLog = log.child({ req_id: 'abc' });
    reqLog.info('http.request', { route: '/x' });
    const parsed = JSON.parse(captured[0].trim());
    assert.equal(parsed.req_id, 'abc');
    assert.equal(parsed.route, '/x');
  });

  it('newRequestId returns 16-hex string', () => {
    assert.match(newRequestId(), /^[a-f0-9]{16}$/);
  });
});
