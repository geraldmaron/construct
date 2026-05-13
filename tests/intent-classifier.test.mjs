/**
 * tests/intent-classifier.test.mjs — verifyIntent + verifyRoute coverage.
 *
 * All tests inject a deterministic `modelCaller` stub. No real LLM calls.
 * Run via npm test.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyIntent, verifyRoute, resetCache, CONFIDENCE_THRESHOLD } from '../lib/intent-classifier.mjs';

function stubCaller(responses) {
  let calls = 0;
  const caller = async () => {
    const resp = responses[calls] ?? responses[responses.length - 1];
    calls += 1;
    if (resp instanceof Error) throw resp;
    return typeof resp === 'string' ? resp : JSON.stringify(resp);
  };
  caller.callCount = () => calls;
  return caller;
}

test('verifyIntent short-circuits when flavor is null', async () => {
  resetCache();
  const r = await verifyIntent({ request: 'foo', specialist: 'cx-architect', flavor: null });
  assert.equal(r.source, 'no-flavor');
  assert.equal(r.verified, true);
});

test('verifyIntent honours CONSTRUCT_INTENT_VERIFY=off', async () => {
  resetCache();
  process.env.CONSTRUCT_INTENT_VERIFY = 'off';
  try {
    const r = await verifyIntent({ request: 'foo', specialist: 'cx-architect', flavor: 'platform' });
    assert.equal(r.source, 'disabled');
    assert.equal(r.verified, true);
  } finally {
    delete process.env.CONSTRUCT_INTENT_VERIFY;
  }
});

test('verifyIntent parses a valid JSON verdict from the model', async () => {
  resetCache();
  const caller = stubCaller([{ verified: true, confidence: 0.92, reason: 'clearly platform infra' }]);
  const r = await verifyIntent({ request: 'design the kubernetes ingress', specialist: 'cx-architect', flavor: 'platform', modelCaller: caller });
  assert.equal(r.source, 'llm');
  assert.equal(r.verified, true);
  assert.equal(r.confidence, 0.92);
  assert.match(r.reason, /platform/);
});

test('verifyIntent recognises a false-positive keyword match', async () => {
  resetCache();
  const caller = stubCaller([{ verified: false, confidence: 0.85, reason: 'request mentions AI in passing only' }]);
  const r = await verifyIntent({ request: 'the AI is slow — fix the cache layer', specialist: 'cx-architect', flavor: 'ai-systems', modelCaller: caller });
  assert.equal(r.verified, false);
  assert.equal(r.confidence, 0.85);
});

test('verifyIntent falls back when the model throws', async () => {
  resetCache();
  const caller = stubCaller([new Error('timeout')]);
  const r = await verifyIntent({ request: 'foo', specialist: 'cx-architect', flavor: 'platform', modelCaller: caller });
  assert.equal(r.source, 'fallback');
  assert.equal(r.verified, true);
  assert.match(r.reason, /timeout/);
});

test('verifyIntent falls back when JSON parse fails', async () => {
  resetCache();
  const caller = stubCaller(['this is not json at all']);
  const r = await verifyIntent({ request: 'foo', specialist: 'cx-architect', flavor: 'platform', modelCaller: caller });
  assert.equal(r.source, 'fallback');
  assert.equal(r.verified, true);
});

test('verifyIntent caches identical requests', async () => {
  resetCache();
  const caller = stubCaller([
    { verified: true, confidence: 0.9, reason: 'first call' },
    { verified: false, confidence: 0.1, reason: 'should not see' },
  ]);
  const first = await verifyIntent({ request: 'same request', specialist: 'cx-architect', flavor: 'data', modelCaller: caller });
  const second = await verifyIntent({ request: 'same request', specialist: 'cx-architect', flavor: 'data', modelCaller: caller });
  assert.equal(first.source, 'llm');
  assert.equal(second.source, 'cache');
  assert.equal(second.confidence, 0.9);
  assert.equal(caller.callCount(), 1);
});

test('verifyRoute drops flavors below confidence threshold', async () => {
  resetCache();
  const route = {
    roleFlavors: {
      architect: 'platform',
      security: 'appsec',
      productManager: null,
    },
    specialists: ['cx-architect', 'cx-engineer'],
  };
  const responses = {
    'cx-architect|platform': { verified: true, confidence: 0.95, reason: 'core infra design' },
    'cx-security|appsec': { verified: false, confidence: 0.3, reason: 'incidental mention' },
  };
  const caller = async ({ user }) => {
    const matchSpec = user.match(/Matched specialist: (\S+)/)[1];
    const matchFlavor = user.match(/Candidate flavor: (\S+)/)[1];
    return JSON.stringify(responses[`${matchSpec}|${matchFlavor}`] ?? { verified: true, confidence: 1, reason: 'default' });
  };

  const verified = await verifyRoute(route, { request: 'design the platform', modelCaller: caller });
  assert.equal(verified.roleFlavors.architect, 'platform');
  assert.equal(verified.roleFlavors.security, null);
  assert.equal(verified.roleFlavors.productManager, null);
  assert.equal(verified.verifications.architect.verified, true);
  assert.equal(verified.verifications.security.verified, false);
  assert.ok(verified.verifications.security.confidence < CONFIDENCE_THRESHOLD);
});

test('verifyRoute leaves the route unchanged when all flavors verify', async () => {
  resetCache();
  const route = {
    roleFlavors: { architect: 'platform' },
    specialists: ['cx-architect'],
  };
  const caller = async () => JSON.stringify({ verified: true, confidence: 0.9, reason: 'clear platform' });
  const verified = await verifyRoute(route, { request: 'design the platform', modelCaller: caller });
  assert.equal(verified.roleFlavors.architect, 'platform');
});

test('verifyRoute is a no-op on a route without roleFlavors', async () => {
  resetCache();
  const r = await verifyRoute({}, { request: 'foo' });
  assert.deepEqual(r, {});
});
