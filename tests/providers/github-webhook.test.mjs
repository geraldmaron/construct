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
 * Delivery dedup/replay protection (construct-h48jh) is exercised against
 * the same real webhook(): a valid delivery id is recorded in a durable
 * JSONL seen-set (lib/providers/github/delivery-log.mjs) and a replay
 * returns a structured duplicate outcome instead of processing again. The
 * cross-process case spawns two real node subprocesses running
 * fixtures/webhook-delivery-call.mjs against the same log file, proving the
 * dedup record survives process death, not just instance reuse. Every
 * dedup test passes an explicit tmp `webhookDeliveryLogPath` so no test
 * ever touches the real machine's ~/.construct state root.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { create } from '../../lib/providers/github/index.mjs';

const SECRET = '__construct_test_webhook_secret__';

// Every tmpLogPath() call registers its dir here; the module-level after()
// sweeps them all once, rather than a try/finally at each of this file's
// call sites.
const TMP_DIRS = [];
after(() => {
  for (const dir of TMP_DIRS) fs.rmSync(dir, { recursive: true, force: true });
});

function sign(secret, body) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

function tmpLogPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-webhook-dedup-'));
  TMP_DIRS.push(dir);
  return path.join(dir, 'github-deliveries.jsonl');
}

function signedRequest(body, { delivery, event = 'issues' } = {}) {
  const headers = { 'x-hub-signature-256': sign(SECRET, body), 'x-github-event': event };
  if (delivery) headers['x-github-delivery'] = delivery;
  return { headers, body };
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

    const result = await provider.webhook({ webhookSecret: SECRET, webhookDeliveryLogPath: tmpLogPath() }, request);
    assert.deepEqual(result, { ok: true, event: 'pull_request', delivery: 'delivery-1', duplicate: false });
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
    assert.deepEqual(result, { ok: true, event: 'unknown', delivery: null, duplicate: false });
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

describe('github provider — webhook delivery dedup / replay protection', () => {
  it('replaying the same delivery id through the same provider instance returns a structured duplicate, not a second processing', async () => {
    const provider = create({ env: {} });
    const config = { webhookSecret: SECRET, webhookDeliveryLogPath: tmpLogPath() };
    const body = JSON.stringify({ action: 'opened' });

    const first = await provider.webhook(config, signedRequest(body, { delivery: 'replay-1' }));
    assert.deepEqual(first, { ok: true, event: 'issues', delivery: 'replay-1', duplicate: false });

    const replay = await provider.webhook(config, signedRequest(body, { delivery: 'replay-1' }));
    assert.equal(replay.ok, true);
    assert.equal(replay.duplicate, true);
    assert.equal(replay.delivery, 'replay-1');
    assert.equal(typeof replay.firstSeenAt, 'string');
    assert.ok(!Number.isNaN(Date.parse(replay.firstSeenAt)), 'firstSeenAt must be a parseable timestamp');
  });

  it('a fresh provider instance sees deliveries recorded by an earlier instance (durable seen-set, not in-memory)', async () => {
    const logPath = tmpLogPath();
    const config = { webhookSecret: SECRET, webhookDeliveryLogPath: logPath };
    const body = JSON.stringify({ action: 'closed' });

    const first = await create({ env: {} }).webhook(config, signedRequest(body, { delivery: 'cross-instance-1' }));
    assert.equal(first.duplicate, false);

    const replay = await create({ env: {} }).webhook(config, signedRequest(body, { delivery: 'cross-instance-1' }));
    assert.equal(replay.duplicate, true);
  });

  it('a replayed delivery survives across two separate real process instantiations', () => {
    const fixture = fileURLToPath(new URL('./fixtures/webhook-delivery-call.mjs', import.meta.url));
    const logPath = tmpLogPath();

    const first = JSON.parse(execFileSync(process.execPath, [fixture, logPath, 'cross-process-1'], { encoding: 'utf8' }));
    assert.equal(first.ok, true);
    assert.equal(first.duplicate, false);

    const second = JSON.parse(execFileSync(process.execPath, [fixture, logPath, 'cross-process-1'], { encoding: 'utf8' }));
    assert.equal(second.ok, true);
    assert.equal(second.duplicate, true);
    assert.equal(second.firstSeenAt, JSON.parse(fs.readFileSync(logPath, 'utf8').trim()).seenAt);
  });

  it('distinct delivery ids are never treated as duplicates', async () => {
    const provider = create({ env: {} });
    const config = { webhookSecret: SECRET, webhookDeliveryLogPath: tmpLogPath() };
    const body = '{}';

    const a = await provider.webhook(config, signedRequest(body, { delivery: 'distinct-a' }));
    const b = await provider.webhook(config, signedRequest(body, { delivery: 'distinct-b' }));
    assert.equal(a.duplicate, false);
    assert.equal(b.duplicate, false);
  });

  it('an invalid signature never records its delivery id, so a later valid request with that id is not a duplicate', async () => {
    const provider = create({ env: {} });
    const logPath = tmpLogPath();
    const config = { webhookSecret: SECRET, webhookDeliveryLogPath: logPath };
    const body = JSON.stringify({ action: 'opened' });

    const forged = await provider.webhook(config, {
      headers: {
        'x-hub-signature-256': sign('wrong-secret', body),
        'x-github-delivery': 'poison-attempt-1',
      },
      body,
    });
    assert.equal(forged.ok, false);
    assert.ok(!fs.existsSync(logPath), 'a rejected request must not create or grow the seen-set');

    const genuine = await provider.webhook(config, signedRequest(body, { delivery: 'poison-attempt-1' }));
    assert.deepEqual(genuine, { ok: true, event: 'issues', delivery: 'poison-attempt-1', duplicate: false });
  });

  it('a delivery id outside the configured retention window is pruned by the next record and can be replayed as new', async () => {
    const provider = create({ env: {} });
    const logPath = tmpLogPath();
    const config = { webhookSecret: SECRET, webhookDeliveryLogPath: logPath, webhookDeliveryRetentionMs: 25 };
    const body = '{}';

    const first = await provider.webhook(config, signedRequest(body, { delivery: 'expiring-1' }));
    assert.equal(first.duplicate, false);

    await new Promise((resolve) => setTimeout(resolve, 60));
    const trigger = await provider.webhook(config, signedRequest(body, { delivery: 'expiring-2' }));
    assert.equal(trigger.duplicate, false);
    assert.ok(!fs.readFileSync(logPath, 'utf8').includes('expiring-1'), 'the expired id must be pruned from the durable log');

    const replayAfterExpiry = await provider.webhook(config, signedRequest(body, { delivery: 'expiring-1' }));
    assert.equal(replayAfterExpiry.duplicate, false);
  });
});
