/**
 * tests/kernel/hosts/interface.test.ts — the host adapter seam.
 *
 * No golden corpus here, and deliberately so: v2's validator is 30 lines of
 * shape checking with no hidden behavior to discover, and the port renames the
 * concept (runtime → host) so a captured message corpus would lock in the old
 * vocabulary. What matters is that the seam still rejects exactly what it
 * rejected: a missing method, an undeclared capability, a non-object.
 *
 * The conformance suite that proves an adapter *honors* the contract is a
 * separate concern from this structural gate — see the module note.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES, hasCapability, validate } from '../../../src/kernel/hosts/interface.ts';
import type { HostAdapter } from '../../../src/kernel/hosts/interface.ts';
import {
  HostError,
  HostNotReadyError,
  InvocationError,
  InvocationTimeoutError,
} from '../../../src/kernel/hosts/errors.ts';

function conformingHost(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    name: 'test-host',
    kind: 'general',
    capabilities: [],
    init: async () => {},
    invoke: async () => ({ id: '1', status: 'ok', output: null, error: null }),
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false, reason: 'interrupt not declared' }),
    ...overrides,
  };
}

test('a minimal conforming host validates', () => {
  assert.deepEqual(validate(conformingHost()), { valid: true, errors: [] });
});

test('a host declaring every known capability validates', () => {
  assert.equal(validate(conformingHost({ capabilities: [...CAPABILITIES] })).valid, true);
});

test('a non-object is rejected outright, with no further errors piled on', () => {
  for (const value of [null, undefined, 'host', 42]) {
    const result = validate(value);
    assert.equal(result.valid, false, String(value));
    assert.deepEqual(result.errors, ['Host must be a non-null object']);
  }
});

test('each required method is individually required', () => {
  for (const method of ['init', 'invoke', 'health', 'cancel']) {
    const result = validate(conformingHost({ [method]: undefined }));
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.includes(`Host must implement ${method}()`),
      `missing ${method} must be reported`,
    );
  }
});

test('cancel() is required even without the interrupt capability', () => {
  // The whole point: an adapter that cannot interrupt must still expose a
  // cancel() that safely no-ops, so callers never branch on method existence.
  const result = validate(conformingHost({ capabilities: [], cancel: undefined }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('Host must implement cancel()'));
});

test('name and kind must be non-empty strings', () => {
  for (const bad of ['', undefined, 42]) {
    assert.equal(validate(conformingHost({ name: bad })).valid, false, `name=${String(bad)}`);
    assert.equal(validate(conformingHost({ kind: bad })).valid, false, `kind=${String(bad)}`);
  }
});

test('capabilities must be an array, and every entry must be known', () => {
  const notArray = validate(conformingHost({ capabilities: 'interrupt' }));
  assert.deepEqual(notArray.errors, ['Host must declare "capabilities" as an array']);

  const unknown = validate(conformingHost({ capabilities: ['interrupt', 'teleport'] }));
  assert.equal(unknown.valid, false);
  assert.deepEqual(unknown.errors, [
    `Unknown capability "teleport". Valid: ${CAPABILITIES.join(', ')}`,
  ]);
});

test('every error is reported, not just the first', () => {
  const result = validate({ capabilities: ['teleport'] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 6, `expected a full report, got ${result.errors.length}`);
});

test('hasCapability is total on malformed input', () => {
  assert.equal(hasCapability(conformingHost({ capabilities: ['stream'] }), 'stream'), true);
  assert.equal(hasCapability(conformingHost(), 'stream'), false);
  assert.equal(hasCapability(null, 'stream'), false);
  assert.equal(hasCapability({}, 'stream'), false);
  assert.equal(hasCapability({ capabilities: 'stream' }, 'stream'), false);
});

test('a validated host is usable through the declared interface', async () => {
  const host = conformingHost() as HostAdapter;
  assert.equal(validate(host).valid, true);
  await host.init();
  assert.deepEqual(await host.invoke({}, { invocationId: '1' }), {
    id: '1',
    status: 'ok',
    output: null,
    error: null,
  });
  assert.deepEqual(await host.health(), { live: true });
  assert.equal((await host.cancel('1')).cancelled, false);
});

test('errors carry a machine-readable code, so callers never string-match', () => {
  const notReady = new HostNotReadyError('acp');
  assert.equal(notReady.code, 'NOT_READY');
  assert.equal(notReady.host, 'acp');
  assert.ok(notReady instanceof HostError);

  assert.equal(new InvocationError('boom').code, 'INVOCATION_FAILED');
  assert.equal(new InvocationError('boom', { code: 'CUSTOM' }).code, 'CUSTOM');

  const timeout = new InvocationTimeoutError('acp', 5000);
  assert.equal(timeout.code, 'INVOCATION_TIMEOUT');
  assert.equal(timeout.timeoutMs, 5000);
  assert.match(timeout.message, /exceeded 5000ms/);
});

test('a cause is preserved for diagnosis', () => {
  const cause = new Error('socket closed');
  assert.equal(new InvocationError('boom', { cause }).cause, cause);
});
