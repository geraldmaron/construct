/**
 * tests/providers/github-webhook.test.mjs — real HMAC-SHA256 webhook
 * signature validation for lib/providers/github/index.mjs (construct-4uxq0.13.3,
 * Phase 9 audit checklist item "webhook signature validation").
 *
 * Calls the real webhook() function with a real crypto.createHmac digest —
 * no fake wire boundary, since signature verification is pure computation
 * over the request object, not a network call. Also covers the length-check
 * guard in webhook()'s signature comparison: crypto.timingSafeEqual throws
 * (rather than returning false) when the supplied and expected signature
 * buffers differ in byte length, which a malformed or truncated header can
 * trigger — the malformed-length cases below assert a graceful mismatch
 * result, not a thrown RangeError.
 *
 * No delivery-dedup or replay-protection test exists here: webhook() only
 * echoes X-GitHub-Delivery back to the caller, it stores and compares
 * nothing, so there is no dedup/replay behavior to exercise (a real gap,
 * reported rather than faked — see construct-4uxq0.13.3's bd notes).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { create } from '../../lib/providers/github/index.mjs';

const SECRET = '__construct_test_webhook_secret__';

function sign(secret, body) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('github provider — webhook signature validation', () => {
  it('accepts a request whose signature matches the real HMAC digest', async () => {
    const provider = create({ env: {} });
    const body = JSON.stringify({ action: 'opened', number: 7 });
    const request = {
      headers: {
        'x-hub-signature-256': sign(SECRET, body),
        'x-github-event': 'pull_request',
        'x-github-delivery': 'delivery-1',
      },
      body,
    };

    const result = await provider.webhook({ webhookSecret: SECRET }, request);
    assert.deepEqual(result, { ok: true, event: 'pull_request', delivery: 'delivery-1' });
  });

  it('rejects a same-length signature that does not match the body', async () => {
    const provider = create({ env: {} });
    const body = JSON.stringify({ action: 'opened' });
    const wrongSameLength = sign(SECRET, JSON.stringify({ action: 'closed' }));
    const request = { headers: { 'x-hub-signature-256': wrongSameLength }, body };

    const result = await provider.webhook({ webhookSecret: SECRET }, request);
    assert.deepEqual(result, { ok: false, error: 'signature mismatch' });
  });

  it('rejects a malformed short signature without throwing (RangeError regression)', async () => {
    const provider = create({ env: {} });
    const body = JSON.stringify({ action: 'opened' });
    const request = { headers: { 'x-hub-signature-256': 'sha256=deadbeef' }, body };

    const result = await provider.webhook({ webhookSecret: SECRET }, request);
    assert.deepEqual(result, { ok: false, error: 'signature mismatch' });
  });

  it('rejects an overlong signature without throwing', async () => {
    const provider = create({ env: {} });
    const body = JSON.stringify({ action: 'opened' });
    const overlong = `${sign(SECRET, body)}${'a'.repeat(32)}`;
    const request = { headers: { 'x-hub-signature-256': overlong }, body };

    const result = await provider.webhook({ webhookSecret: SECRET }, request);
    assert.deepEqual(result, { ok: false, error: 'signature mismatch' });
  });

  it('rejects a request with no signature header', async () => {
    const provider = create({ env: {} });
    const result = await provider.webhook({ webhookSecret: SECRET }, { headers: {}, body: '{}' });
    assert.deepEqual(result, { ok: false, error: 'missing or malformed signature header' });
  });

  it('rejects a signature header missing the sha256= prefix', async () => {
    const provider = create({ env: {} });
    const body = '{}';
    const bareHex = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    const result = await provider.webhook({ webhookSecret: SECRET }, { headers: { 'x-hub-signature-256': bareHex }, body });
    assert.deepEqual(result, { ok: false, error: 'missing or malformed signature header' });
  });

  it('rejects when no webhookSecret is configured, before touching the signature at all', async () => {
    const provider = create({ env: {} });
    const result = await provider.webhook({}, { headers: { 'x-hub-signature-256': 'sha256=anything' }, body: '{}' });
    assert.deepEqual(result, { ok: false, error: 'webhookSecret not configured' });
  });

  it('defaults event to "unknown" and delivery to null when those headers are absent on an otherwise-valid request', async () => {
    const provider = create({ env: {} });
    const body = '{}';
    const result = await provider.webhook({ webhookSecret: SECRET }, { headers: { 'x-hub-signature-256': sign(SECRET, body) }, body });
    assert.deepEqual(result, { ok: true, event: 'unknown', delivery: null });
  });

  it('verifies against a Buffer body the same way as a string body', async () => {
    const provider = create({ env: {} });
    const bodyStr = JSON.stringify({ action: 'reopened' });
    const bodyBuf = Buffer.from(bodyStr);
    const request = { headers: { 'x-hub-signature-256': sign(SECRET, bodyStr) }, body: bodyBuf };

    const result = await provider.webhook({ webhookSecret: SECRET }, request);
    assert.equal(result.ok, true);
  });
});
