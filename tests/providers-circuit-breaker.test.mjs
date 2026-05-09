/**
 * tests/providers-circuit-breaker.test.mjs — circuit breaker semantics.
 *
 * Verifies:
 *   - CLOSED → OPEN after failureThreshold consecutive failures.
 *   - OPEN immediately fails subsequent calls with CircuitOpenError.
 *   - OPEN → HALF_OPEN after cooldownMs.
 *   - HALF_OPEN success → CLOSED; HALF_OPEN failure → OPEN again.
 *   - Successful runs in CLOSED reset the failure counter.
 *   - Per-key isolation: separate breakers don't share state.
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  getBreaker,
  describeBreakers,
  resetBreaker,
  clearBreakerRegistry,
  STATES,
  CircuitOpenError,
} from '../lib/providers/circuit-breaker.mjs';

beforeEach(() => clearBreakerRegistry());

describe('circuit breaker', () => {
  it('CLOSED → OPEN after threshold consecutive failures', async () => {
    const b = getBreaker('a', { failureThreshold: 3, cooldownMs: 1000 });
    const fail = () => Promise.reject(new Error('boom'));
    for (let i = 0; i < 3; i++) {
      await assert.rejects(b.run(fail), /boom/);
    }
    assert.equal(b.state, STATES.OPEN);
    assert.ok(b.openedAt);
  });

  it('OPEN fails fast with CircuitOpenError', async () => {
    const b = getBreaker('b', { failureThreshold: 1, cooldownMs: 60_000 });
    await assert.rejects(b.run(() => Promise.reject(new Error('first'))), /first/);
    let calls = 0;
    await assert.rejects(
      b.run(() => { calls++; return Promise.resolve('should not run'); }),
      CircuitOpenError
    );
    assert.equal(calls, 0, 'fn must not be invoked while OPEN');
  });

  it('OPEN → HALF_OPEN after cooldown, then back to CLOSED on probe success', async () => {
    const b = getBreaker('c', { failureThreshold: 1, cooldownMs: 50 });
    await assert.rejects(b.run(() => Promise.reject(new Error('boom'))));
    assert.equal(b.state, STATES.OPEN);
    await new Promise((r) => setTimeout(r, 80));
    const result = await b.run(() => Promise.resolve(42));
    assert.equal(result, 42);
    assert.equal(b.state, STATES.CLOSED);
    assert.equal(b.failureCount, 0);
  });

  it('HALF_OPEN failure re-opens with a new openedAt', async () => {
    const b = getBreaker('d', { failureThreshold: 1, cooldownMs: 50 });
    await assert.rejects(b.run(() => Promise.reject(new Error('a'))));
    const firstOpenedAt = b.openedAt;
    await new Promise((r) => setTimeout(r, 80));
    await assert.rejects(b.run(() => Promise.reject(new Error('probe-fail'))), /probe-fail/);
    assert.equal(b.state, STATES.OPEN);
    assert.ok(b.openedAt > firstOpenedAt);
  });

  it('successful runs in CLOSED reset the failure counter', async () => {
    const b = getBreaker('e', { failureThreshold: 5 });
    await assert.rejects(b.run(() => Promise.reject(new Error('1'))));
    await assert.rejects(b.run(() => Promise.reject(new Error('2'))));
    await b.run(() => Promise.resolve('ok'));
    assert.equal(b.failureCount, 0);
    assert.equal(b.state, STATES.CLOSED);
  });

  it('isFailure predicate skips expected errors', async () => {
    const b = getBreaker('f', {
      failureThreshold: 2,
      isFailure: (err) => !err.expected,
    });
    const expected = Object.assign(new Error('skipme'), { expected: true });
    for (let i = 0; i < 5; i++) {
      await assert.rejects(b.run(() => Promise.reject(expected)));
    }
    assert.equal(b.state, STATES.CLOSED);
    assert.equal(b.failureCount, 0);
  });

  it('per-key isolation', async () => {
    const a = getBreaker('iso-a', { failureThreshold: 1 });
    const b = getBreaker('iso-b', { failureThreshold: 1 });
    await assert.rejects(a.run(() => Promise.reject(new Error('x'))));
    assert.equal(a.state, STATES.OPEN);
    assert.equal(b.state, STATES.CLOSED);
  });

  it('describeBreakers reports current state per key', async () => {
    const a = getBreaker('desc-a', { failureThreshold: 1 });
    await assert.rejects(a.run(() => Promise.reject(new Error('boom'))));
    getBreaker('desc-b');
    const summary = describeBreakers();
    assert.equal(summary.length, 2);
    const aSummary = summary.find((s) => s.key === 'desc-a');
    assert.equal(aSummary.state, STATES.OPEN);
  });

  it('resetBreaker forces CLOSED', async () => {
    const b = getBreaker('reset', { failureThreshold: 1 });
    await assert.rejects(b.run(() => Promise.reject(new Error('boom'))));
    resetBreaker('reset');
    assert.equal(b.state, STATES.CLOSED);
    assert.equal(b.failureCount, 0);
  });
});
