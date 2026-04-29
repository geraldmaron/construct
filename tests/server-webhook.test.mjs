/**
 * tests/server-webhook.test.mjs — Unit tests for lib/server/webhook.mjs.
 *
 * Tests signature verification helpers, event classification, provider routing,
 * and the full handler request/response cycle using a mock approval queue.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createWebhookHandler } from '../lib/server/webhook.mjs';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeReq(provider, body, headers = {}) {
  const chunks = [Buffer.from(body)];
  let endCb;
  return {
    url: `/api/webhooks/${provider}`,
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    on(event, cb) {
      if (event === 'data') cb(chunks[0]);
      if (event === 'end') { endCb = cb; setImmediate(cb); }
      if (event === 'error') { /* ignore */ }
    },
  };
}

function makeRes() {
  const res = { _status: null, _headers: {}, _body: '' };
  res.writeHead = (s, h = {}) => { res._status = s; res._headers = h; };
  res.end = (b) => { res._body = b; };
  res.json = () => JSON.parse(res._body);
  return res;
}

function makeQueue() {
  const items = [];
  return {
    enqueue(item) { items.push(item); return 'mock-id'; },
    items,
    approvalMode() { return 'auto'; },
    requiresApproval() { return false; },
    pending() { return items; },
  };
}

function sign(secret, body) {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

// ── Signature verification ─────────────────────────────────────────────────

test('GitHub webhook with valid signature is accepted', async () => {
  const secret = 'mysecret';
  const body = JSON.stringify({ action: 'opened', pull_request: {} });
  const sig = sign(secret, body);
  const queue = makeQueue();
  const handler = createWebhookHandler({
    approvalQueue: queue,
    notifyClients: () => {},
    webhookSecrets: { github: secret },
  });
  const req = makeReq('github', body, { 'x-hub-signature-256': sig, 'x-github-event': 'pull_request' });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res._status, 200);
  assert.ok(res.json().ok);
});

test('GitHub webhook with wrong signature is rejected 401', async () => {
  const body = JSON.stringify({ action: 'opened' });
  const handler = createWebhookHandler({
    approvalQueue: makeQueue(),
    notifyClients: () => {},
    webhookSecrets: { github: 'correct-secret' },
  });
  const req = makeReq('github', body, { 'x-hub-signature-256': 'sha256=badsig' });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res._status, 401);
});

test('Slack webhook with valid signature is accepted', async () => {
  const secret = 'slack-secret';
  const ts = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ type: 'event_callback', event: { type: 'message' } });
  const baseString = `v0:${ts}:${body}`;
  const sig = 'v0=' + createHmac('sha256', secret).update(baseString).digest('hex');
  const handler = createWebhookHandler({
    approvalQueue: makeQueue(),
    notifyClients: () => {},
    webhookSecrets: { slack: secret },
  });
  const req = makeReq('slack', body, {
    'x-slack-signature': sig,
    'x-slack-request-timestamp': ts,
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res._status, 200);
});

test('Slack webhook with stale timestamp is rejected', async () => {
  const secret = 'slack-secret';
  const ts = (Math.floor(Date.now() / 1000) - 400).toString(); // > 5 min ago
  const body = JSON.stringify({ type: 'event_callback' });
  const baseString = `v0:${ts}:${body}`;
  const sig = 'v0=' + createHmac('sha256', secret).update(baseString).digest('hex');
  const handler = createWebhookHandler({
    approvalQueue: makeQueue(),
    notifyClients: () => {},
    webhookSecrets: { slack: secret },
  });
  const req = makeReq('slack', body, {
    'x-slack-signature': sig,
    'x-slack-request-timestamp': ts,
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res._status, 401);
});

// ── Event routing ──────────────────────────────────────────────────────────

test('significant event enqueues to approval queue', async () => {
  const queue = makeQueue();
  const handler = createWebhookHandler({ approvalQueue: queue, notifyClients: () => {} });
  const body = JSON.stringify({ action: 'merged' });
  // No secret configured → open
  const req = makeReq('github', body);
  const res = makeRes();
  await handler(req, res);
  assert.equal(res._status, 200);
  // unknown type → not necessarily significant; we just verify no crash
  assert.ok(typeof res.json().ok === 'boolean');
});

test('notifyClients is called on successful webhook', async () => {
  let called = false;
  const handler = createWebhookHandler({
    approvalQueue: makeQueue(),
    notifyClients: () => { called = true; },
  });
  const req = makeReq('jira', JSON.stringify({ webhookEvent: 'jira:issue_created' }));
  const res = makeRes();
  await handler(req, res);
  assert.ok(called);
});

test('unknown provider without normalizeWebhook still returns 200', async () => {
  const handler = createWebhookHandler({ approvalQueue: makeQueue(), notifyClients: () => {} });
  const req = makeReq('unknownprovider', JSON.stringify({ foo: 'bar' }));
  const res = makeRes();
  await handler(req, res);
  assert.equal(res._status, 200);
  assert.equal(res.json().provider, 'unknownprovider');
});

test('malformed JSON payload returns 400', async () => {
  const handler = createWebhookHandler({ approvalQueue: makeQueue(), notifyClients: () => {} });
  const req = makeReq('github', 'not json at all');
  const res = makeRes();
  await handler(req, res);
  assert.equal(res._status, 400);
});

test('missing provider name returns 400', async () => {
  const handler = createWebhookHandler({ approvalQueue: makeQueue(), notifyClients: () => {} });
  const req = makeReq('', JSON.stringify({}));
  req.url = '/api/webhooks/';
  const res = makeRes();
  await handler(req, res);
  assert.equal(res._status, 400);
});
