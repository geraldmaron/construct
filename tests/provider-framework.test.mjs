/**
 * tests/provider-framework.test.mjs — tests for provider interface, registry, and errors.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validate, hasCapability, CAPABILITIES } from '../providers/lib/interface.mjs';
import { ProviderRegistry } from '../providers/lib/registry.mjs';
import {
  ProviderError,
  CapabilityNotSupported,
  AuthError,
  RateLimitError,
  NotFoundError,
} from '../providers/lib/errors.mjs';

// ── Minimal valid provider fixture ──────────────────────────────────────

function makeProvider(overrides = {}) {
  return {
    name: 'test-provider',
    capabilities: ['read', 'search'],
    async init() {},
    async read() { return [{ id: '1', title: 'item' }]; },
    async search() { return []; },
    ...overrides,
  };
}

// ── Interface validation ────────────────────────────────────────────────

describe('Provider interface validation', () => {
  it('accepts a valid provider', () => {
    const result = validate(makeProvider());
    assert.ok(result.valid);
    assert.equal(result.errors.length, 0);
  });

  it('rejects null', () => {
    const result = validate(null);
    assert.ok(!result.valid);
  });

  it('rejects missing name', () => {
    const result = validate(makeProvider({ name: '' }));
    assert.ok(!result.valid);
  });

  it('rejects missing capabilities array', () => {
    const result = validate(makeProvider({ capabilities: 'read' }));
    assert.ok(!result.valid);
  });

  it('rejects unknown capability', () => {
    const result = validate(makeProvider({ capabilities: ['read', 'teleport'], teleport() {} }));
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes('teleport')));
  });

  it('rejects declared capability without implementation', () => {
    const p = makeProvider();
    delete p.read;
    const result = validate(p);
    assert.ok(!result.valid);
  });

  it('rejects missing init', () => {
    const p = makeProvider();
    delete p.init;
    const result = validate(p);
    assert.ok(!result.valid);
  });
});

// ── hasCapability ───────────────────────────────────────────────────────

describe('hasCapability', () => {
  it('returns true for declared capability', () => {
    assert.ok(hasCapability(makeProvider(), 'read'));
  });

  it('returns false for undeclared capability', () => {
    assert.ok(!hasCapability(makeProvider(), 'write'));
  });
});

// ── Registry ────────────────────────────────────────────────────────────

describe('ProviderRegistry', () => {
  it('registers and retrieves a provider', () => {
    const reg = new ProviderRegistry();
    reg.register(makeProvider());
    assert.equal(reg.get('test-provider').name, 'test-provider');
  });

  it('lists registered providers', () => {
    const reg = new ProviderRegistry();
    reg.register(makeProvider({ name: 'a' }));
    reg.register(makeProvider({ name: 'b' }));
    assert.deepEqual(reg.list().sort(), ['a', 'b']);
  });

  it('filters by capability', () => {
    const reg = new ProviderRegistry();
    reg.register(makeProvider({ name: 'reader', capabilities: ['read'], async read() {} }));
    reg.register(makeProvider({ name: 'writer', capabilities: ['write'], async write() {}, read: undefined }));
    // 'writer' won't validate because it has no read but declares write — let's fix
    const writer = { name: 'writer', capabilities: ['write'], async init() {}, async write() {} };
    const reg2 = new ProviderRegistry();
    reg2.register(makeProvider({ name: 'reader' }));
    reg2.register(writer);
    assert.equal(reg2.withCapability('write').length, 1);
    assert.equal(reg2.withCapability('write')[0].name, 'writer');
  });

  it('throws on invalid provider', () => {
    const reg = new ProviderRegistry();
    assert.throws(() => reg.register({}), /Invalid provider/);
  });

  it('dispatches capability calls', async () => {
    const reg = new ProviderRegistry();
    reg.register(makeProvider());
    const result = await reg.dispatch('test-provider', 'read', 'some-ref');
    assert.ok(Array.isArray(result));
  });

  it('throws CapabilityNotSupported on missing capability', async () => {
    const reg = new ProviderRegistry();
    reg.register(makeProvider());
    await assert.rejects(
      () => reg.dispatch('test-provider', 'write', {}),
      (err) => err instanceof CapabilityNotSupported,
    );
  });

  it('throws on unknown provider', async () => {
    const reg = new ProviderRegistry();
    await assert.rejects(() => reg.dispatch('ghost', 'read'));
  });

  it('initAll reports status per provider', async () => {
    const reg = new ProviderRegistry();
    reg.register(makeProvider({ name: 'ok' }));
    reg.register(makeProvider({ name: 'fail', async init() { throw new Error('boom'); } }));
    const results = await reg.initAll();
    assert.equal(results.find((r) => r.name === 'ok').status, 'ready');
    assert.equal(results.find((r) => r.name === 'fail').status, 'error');
  });
});

// ── Error hierarchy ─────────────────────────────────────────────────────

describe('Provider errors', () => {
  it('CapabilityNotSupported has correct fields', () => {
    const err = new CapabilityNotSupported('github', 'watch');
    assert.ok(err instanceof ProviderError);
    assert.equal(err.provider, 'github');
    assert.equal(err.capability, 'watch');
    assert.equal(err.code, 'CAPABILITY_NOT_SUPPORTED');
  });

  it('RateLimitError includes retryAfter', () => {
    const err = new RateLimitError('slow down', { retryAfter: 30 });
    assert.equal(err.retryAfter, 30);
    assert.equal(err.code, 'RATE_LIMIT');
  });

  it('AuthError has AUTH_ERROR code', () => {
    const err = new AuthError('bad token');
    assert.equal(err.code, 'AUTH_ERROR');
  });

  it('NotFoundError has NOT_FOUND code', () => {
    const err = new NotFoundError('no such item');
    assert.equal(err.code, 'NOT_FOUND');
  });
});
