/**
 * tests/doctor/provider-breaker-watcher.test.mjs — doctor watcher.
 *
 * Fixture-forces a provider circuit breaker OPEN via lib/providers/circuit-
 * breaker.mjs's real getBreaker(), then asserts the provider-breaker watcher's
 * tick() emits a provider.circuit_open escalation exactly once per open
 * episode, logs a recovery record on CLOSED, and stays silent for a healthy
 * (never-failing) breaker.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { tempDir } from '../helpers.mjs';

let watcher;
let audit;
let getBreaker;
let clearBreakerRegistry;

test.before(async () => {
  process.env.CONSTRUCT_DOCTOR_ROOT = tempDir('construct-doctor-provider-breaker-');
  audit = await import('../../lib/doctor/audit.mjs');
  watcher = await import('../../lib/doctor/watchers/provider-breaker.mjs');
  ({ getBreaker, clearBreakerRegistry } = await import('../../lib/providers/circuit-breaker.mjs'));
});

test.beforeEach(() => {
  clearBreakerRegistry();
  watcher.__resetProviderBreakerWatcherState();
});

function forceOpen(providerId, { failureThreshold = 5 } = {}) {
  const breaker = getBreaker(`provider:${providerId}`, { failureThreshold, cooldownMs: 30_000 });
  for (let i = 0; i < failureThreshold; i++) {
    breaker._recordFailure();
  }
  return breaker;
}

test('a fixture-forced OPEN breaker triggers exactly one escalation per open episode', async () => {
  forceOpen('github');

  const first = await watcher.tick();
  assert.equal(first.escalations.length, 1);
  assert.equal(first.escalations[0].eventType, 'provider.circuit_open');
  assert.equal(first.escalations[0].provider, 'github');

  const second = await watcher.tick();
  assert.equal(second.escalations.length, 0, 'the same open episode must not re-escalate on the next tick');

  const recorded = audit.recent({ watcher: 'provider-breaker', kind: 'sample' });
  assert.ok(recorded.some((r) => r.target === 'github' && r.result === 'open'));
});

test('a breaker with no failures never escalates', async () => {
  getBreaker('provider:slack', { failureThreshold: 5, cooldownMs: 30_000 });
  const result = await watcher.tick();
  assert.equal(result.escalations.length, 0);
});

test('recovery to CLOSED after an escalated OPEN episode logs a recovery record', async () => {
  const breaker = forceOpen('linear');
  await watcher.tick();

  breaker.reset();
  const result = await watcher.tick();
  assert.equal(result.escalations.length, 0);

  const recoveries = audit.recent({ watcher: 'provider-breaker', kind: 'recovery' });
  assert.ok(recoveries.some((r) => r.target === 'linear'));
});

test('a fresh OPEN episode after recovery escalates again', async () => {
  const breaker = forceOpen('jira');
  await watcher.tick();
  breaker.reset();
  await watcher.tick();

  for (let i = 0; i < 5; i++) breaker._recordFailure();
  const result = await watcher.tick();
  assert.equal(result.escalations.length, 1, 'a new open episode (new openedAt) must escalate again');
});

test('non-provider breaker keys are ignored', async () => {
  getBreaker('some-other-subsystem:x', { failureThreshold: 1, cooldownMs: 30_000 })._recordFailure();
  const result = await watcher.tick();
  assert.equal(result.escalations.length, 0);
  assert.equal(result.notes.length, 0);
});
