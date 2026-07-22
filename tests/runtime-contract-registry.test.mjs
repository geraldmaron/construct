/**
 * tests/runtime-contract-registry.test.mjs — unit tests for the runtime
 * registry and its default wiring.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeRegistry } from '../lib/runtime/contract/registry.mjs';
import { createDefaultRuntimeRegistry, DEFAULT_RUNTIME_FACTORIES } from '../lib/runtime/contract/default-registry.mjs';
import { validate } from '../lib/runtime/contract/interface.mjs';

describe('runtime registry', () => {
  it('resolves a registered factory', () => {
    const registry = createRuntimeRegistry({ echo: () => ({ tag: 'v1' }) });
    assert.deepEqual(registry.resolve('echo'), { tag: 'v1' });
  });

  it('throws a listing error for an unknown key', () => {
    const registry = createRuntimeRegistry({ a: () => ({}), b: () => ({}) });
    assert.throws(() => registry.resolve('missing'), /unknown runtime "missing".*known: a, b/);
  });

  it('register() replaces a key without mutating an already-resolved instance', () => {
    const registry = createRuntimeRegistry({ slot: () => ({ tag: 'v1' }) });
    const first = registry.resolve('slot');
    registry.register('slot', () => ({ tag: 'v2' }));
    const second = registry.resolve('slot');
    assert.equal(first.tag, 'v1');
    assert.equal(second.tag, 'v2');
  });

  it('has()/keys() reflect registered entries', () => {
    const registry = createRuntimeRegistry({ a: () => ({}) });
    assert.equal(registry.has('a'), true);
    assert.equal(registry.has('b'), false);
    assert.deepEqual(registry.keys(), ['a']);
  });
});

describe('default runtime registry', () => {
  it('wires a conforming runtime instance for every directive-named shape', () => {
    const registry = createDefaultRuntimeRegistry();
    assert.deepEqual(registry.keys().sort(), Object.keys(DEFAULT_RUNTIME_FACTORIES).sort());
    for (const key of registry.keys()) {
      const runtime = registry.resolve(key);
      const result = validate(runtime);
      assert.ok(result.valid, `"${key}" failed validation: ${result.errors.join('; ')}`);
    }
  });
});
