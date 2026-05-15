/**
 * tests/langfuse-login.test.mjs — local Langfuse magic-link bridge.
 *
 * Pins the HTML rendering (escaping + form shape), the 200/502 status
 * branching against a stub fetch, and the LANGFUSE_LOGIN_DEFAULTS
 * pulling from the shipped LANGFUSE_LOCAL_* constants so the seeded
 * docker-compose creds and the bridge stay in sync.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LANGFUSE_LOGIN_DEFAULTS,
  renderAutoSubmitForm,
  handleLangfuseLogin,
} from '../lib/server/langfuse-login.mjs';
import {
  LANGFUSE_LOCAL_BASEURL,
  LANGFUSE_LOCAL_ADMIN_EMAIL,
  LANGFUSE_LOCAL_ADMIN_PASSWORD,
} from '../lib/services/langfuse.mjs';

function makeResponseSpy() {
  const calls = { status: null, headers: null, body: '' };
  return {
    spy: calls,
    res: {
      writeHead: (status, headers) => { calls.status = status; calls.headers = headers; },
      end: (body) => { calls.body = body; },
    },
  };
}

describe('LANGFUSE_LOGIN_DEFAULTS', () => {
  it('pulls from the shipped local constants so docker-compose and bridge stay in sync', () => {
    assert.equal(LANGFUSE_LOGIN_DEFAULTS.baseUrl, LANGFUSE_LOCAL_BASEURL);
    assert.equal(LANGFUSE_LOGIN_DEFAULTS.email, LANGFUSE_LOCAL_ADMIN_EMAIL);
    assert.equal(LANGFUSE_LOGIN_DEFAULTS.password, LANGFUSE_LOCAL_ADMIN_PASSWORD);
  });
});

describe('renderAutoSubmitForm', () => {
  it('renders an auto-submit form with all four hidden fields', () => {
    const html = renderAutoSubmitForm({
      csrfToken: 'csrf-123',
      callbackUrl: 'http://lf.test/api/auth/callback/credentials',
      redirectAfter: 'http://lf.test/',
      email: 'admin@example.com',
      password: 'p',
    });
    assert.match(html, /<form id="lf" method="POST"/);
    assert.match(html, /name="csrfToken"\s+value="csrf-123"/);
    assert.match(html, /name="email"\s+value="admin@example\.com"/);
    assert.match(html, /name="password"\s+value="p"/);
    assert.match(html, /name="callbackUrl"\s+value="http:\/\/lf\.test\/"/);
    assert.match(html, /document\.getElementById\('lf'\)\.submit\(\)/);
  });

  it('escapes HTML-special characters in every interpolated field', () => {
    const html = renderAutoSubmitForm({
      csrfToken: '<csrf>',
      callbackUrl: 'http://lf.test/cb?a=1&b=2',
      redirectAfter: 'http://lf.test/?next=<x>',
      email: 'a"b@c.com',
      password: `it's`,
    });
    assert.match(html, /value="&lt;csrf&gt;"/);
    // callbackUrl renders into the form action attribute, not a hidden value.
    assert.match(html, /action="http:\/\/lf\.test\/cb\?a=1&amp;b=2"/);
    assert.match(html, /value="http:\/\/lf\.test\/\?next=&lt;x&gt;"/);
    assert.match(html, /value="a&quot;b@c\.com"/);
    assert.match(html, /value="it&#39;s"/);
    // No raw '<' or '"' breaking the form
    assert.ok(!/value="<csrf>"/.test(html));
  });
});

describe('handleLangfuseLogin', () => {
  it('returns 200 + auto-submit HTML when Langfuse CSRF fetch succeeds', async () => {
    const { spy, res } = makeResponseSpy();
    const fetchFn = async (url) => {
      assert.match(url, /\/api\/auth\/csrf$/);
      return { ok: true, status: 200, json: async () => ({ csrfToken: 'tok-abc' }) };
    };
    await handleLangfuseLogin({}, res, {
      baseUrl: 'http://lf.test',
      email: 'admin@lf.test',
      password: 'pw',
      fetchFn,
    });
    assert.equal(spy.status, 200);
    assert.match(spy.headers['Content-Type'], /text\/html/);
    assert.equal(spy.headers['Cache-Control'], 'no-store');
    assert.match(spy.body, /value="tok-abc"/);
    assert.match(spy.body, /value="admin@lf\.test"/);
  });

  it('returns 502 with a human-readable message when the CSRF fetch fails', async () => {
    const { spy, res } = makeResponseSpy();
    const fetchFn = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await handleLangfuseLogin({}, res, {
      baseUrl: 'http://lf.test',
      fetchFn,
    });
    assert.equal(spy.status, 502);
    assert.match(spy.body, /Could not reach local Langfuse/);
    assert.match(spy.body, /construct up/);
  });

  it('returns 502 when fetch itself throws (Langfuse not running at all)', async () => {
    const { spy, res } = makeResponseSpy();
    const fetchFn = async () => { throw new Error('ECONNREFUSED'); };
    await handleLangfuseLogin({}, res, {
      baseUrl: 'http://lf.test',
      fetchFn,
    });
    assert.equal(spy.status, 502);
    assert.match(spy.body, /ECONNREFUSED/);
    assert.match(spy.body, /construct up/);
  });
});
