/**
 * tests/secret-resolver-audit.test.mjs
 *
 * Guards construct-trxz.6: secret resolution emits a structured, value-free audit
 * event (which variable, which source tier, op-ref flag, cache-hit, outcome) and
 * the materialized secret value never appears in any event payload. The sink is
 * opt-in and defaults to none, so the default path stays hermetic.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveSecret,
  setSecretAuditSink,
  __resetSecretAuditSink,
  __clearSecretCache,
} from '../lib/providers/secret-resolver.mjs';

const RESOLVED = 'resolved-canary-zzz-not-a-key';

function collector() {
  const events = [];
  setSecretAuditSink((e) => events.push(e));
  return events;
}

test('op:// resolution emits resolve + op_read events without the value, and caches', (t) => {
  const events = collector();
  t.after(() => { __resetSecretAuditSink(); __clearSecretCache(); });

  const opRead = () => RESOLVED;
  const env = { ANTHROPIC_API_KEY: 'op://Vault/Item/credential' };

  // Hermetic: the injected env is the only source, so a real config.env on the host
  // (which, per the unified precedence ladder, would otherwise win) cannot shadow it.
  const first = resolveSecret('ANTHROPIC_API_KEY', { env, opRead, allowAmbient: false });
  assert.equal(first, RESOLVED);

  const resolveEvt = events.find((e) => e.event === 'secret.resolve');
  assert.ok(resolveEvt, 'a secret.resolve event is emitted');
  assert.equal(resolveEvt.varName, 'ANTHROPIC_API_KEY');
  assert.equal(resolveEvt.source, 'env');
  assert.equal(resolveEvt.isOpRef, true);
  assert.equal(resolveEvt.ok, true);

  const opEvt = events.find((e) => e.event === 'secret.op_read');
  assert.ok(opEvt, 'a secret.op_read event is emitted');
  assert.equal(opEvt.ref, 'op://Vault/Item/credential');
  assert.equal(opEvt.cacheHit, false);
  assert.equal(opEvt.ok, true);

  const second = resolveSecret('ANTHROPIC_API_KEY', { env, opRead, allowAmbient: false });
  assert.equal(second, RESOLVED);
  const cacheHits = events.filter((e) => e.event === 'secret.op_read' && e.cacheHit === true);
  assert.equal(cacheHits.length, 1, 'the second resolve is a cache hit');

  assert.equal(JSON.stringify(events).includes(RESOLVED), false, 'no event payload contains the resolved value');
});

test('plain value resolution records source and op-ref flag, never the value', (t) => {
  const events = collector();
  t.after(() => { __resetSecretAuditSink(); __clearSecretCache(); });

  const plain = 'plain-canary-value-xx';
  const value = resolveSecret('OPENAI_API_KEY', { env: { OPENAI_API_KEY: plain }, allowAmbient: false });
  assert.equal(value, plain);

  const evt = events.find((e) => e.event === 'secret.resolve');
  assert.equal(evt.varName, 'OPENAI_API_KEY');
  assert.equal(evt.source, 'env');
  assert.equal(evt.isOpRef, false);
  assert.equal(evt.ok, true);
  assert.equal(JSON.stringify(events).includes(plain), false, 'no event payload contains the plain value');
});

test('a miss emits a value-free not-found event', (t) => {
  const events = collector();
  t.after(() => { __resetSecretAuditSink(); __clearSecretCache(); });

  const value = resolveSecret('OPENROUTER_API_KEY', { env: {}, allowAmbient: false });
  assert.equal(value, null);

  const evt = events.find((e) => e.event === 'secret.resolve');
  assert.equal(evt.varName, 'OPENROUTER_API_KEY');
  assert.equal(evt.source, null);
  assert.equal(evt.ok, false);
});
