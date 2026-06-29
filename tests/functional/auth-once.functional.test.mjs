/**
 * tests/functional/auth-once.functional.test.mjs
 *
 * The auth-once contract: a single op:// reference is resolved through the one
 * resolver (lib/providers/secret-resolver.mjs) and cached, so a second read of
 * the same reference never spawns `op` again (no repeat biometric prompt).
 * Uses an injected opRead so the test is hermetic — it never shells out to the
 * real 1Password CLI. Also asserts plain values bypass op entirely and that the
 * cache can be cleared.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveOpRef,
  resolveSecret,
  __clearSecretCache,
} from '../../lib/providers/secret-resolver.mjs';

const OP_REF = 'op://Private/test-item/credential';

function countingOpRead(value) {
  let calls = 0;
  const opRead = (ref) => {
    calls += 1;
    return `${value}:${ref}`;
  };
  return { opRead, calls: () => calls };
}

test('resolveOpRef resolves once and caches the reference', () => {
  __clearSecretCache();
  const { opRead, calls } = countingOpRead('secret');

  const first = resolveOpRef(OP_REF, { opRead });
  const second = resolveOpRef(OP_REF, { opRead });

  assert.equal(first, second, 'both reads return the same secret');
  assert.equal(calls(), 1, 'op is spawned exactly once for a repeated reference');
});

test('resolveSecret materializes an op:// value through the single resolver and caches it', () => {
  __clearSecretCache();
  const { opRead, calls } = countingOpRead('apikey');
  const env = { MY_TOKEN: `$(op read '${OP_REF}')` };

  const a = resolveSecret('MY_TOKEN', { env, opRead });
  const b = resolveSecret('MY_TOKEN', { env, opRead });

  assert.ok(a && a.startsWith('apikey:'), 'op:// value is materialized');
  assert.equal(a, b, 'second resolve returns the cached value');
  assert.equal(calls(), 1, 'auth-once: the second resolve does not spawn op again');
});

test('a plain value bypasses op entirely', () => {
  __clearSecretCache();
  const { opRead, calls } = countingOpRead('unused');
  const env = { PLAIN_KEY: 'sk-plain-value' };

  const value = resolveSecret('PLAIN_KEY', { env, opRead });

  assert.equal(value, 'sk-plain-value', 'plain values pass through unchanged');
  assert.equal(calls(), 0, 'op is never spawned for a non-op value');
});

test('__clearSecretCache forces the next reference read to spawn op again', () => {
  __clearSecretCache();
  const { opRead, calls } = countingOpRead('secret');

  resolveOpRef(OP_REF, { opRead });
  __clearSecretCache();
  resolveOpRef(OP_REF, { opRead });

  assert.equal(calls(), 2, 'clearing the cache invalidates the resolve-once memo');
});
