/**
 * tests/config/env-number-defaults.test.mjs — resolveNonNegativeSetting env parsing.
 *
 * Verifies the shared helper `resolveNonNegativeSetting(env, key, fallback)` correctly
 * parses numeric environment variables: explicit 0 is preserved (not coerced to
 * fallback), unset/missing/blank/non-numeric/negative values fall back, and positive
 * values pass through. A real integration assertion confirms an actual call site
 * (resolveWebCapability) routes its env through the helper rather than a bare
 * `Number(env) || literal` (construct-o6t8.3).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { resolveNonNegativeSetting } from '../../lib/env-config.mjs';
import { resolveWebCapability } from '../../lib/orchestration/web-capability.mjs';

describe('resolveNonNegativeSetting(env, key, fallback)', () => {
  const unitTests = [
    { name: 'undefined env returns fallback', env: undefined, key: 'KEY', fallback: 100, expected: 100 },
    { name: 'null env returns fallback', env: null, key: 'KEY', fallback: 100, expected: 100 },
    { name: 'empty object env returns fallback', env: {}, key: 'KEY', fallback: 100, expected: 100 },
    { name: 'missing key returns fallback', env: { OTHER: '123' }, key: 'KEY', fallback: 100, expected: 100 },
    { name: 'explicit 0 returns 0 (not fallback)', env: { KEY: '0' }, key: 'KEY', fallback: 100, expected: 0 },
    { name: 'explicit 0 as number returns 0', env: { KEY: 0 }, key: 'KEY', fallback: 100, expected: 0 },
    { name: 'positive number returns value', env: { KEY: '250' }, key: 'KEY', fallback: 100, expected: 250 },
    { name: 'positive number as number returns value', env: { KEY: 250 }, key: 'KEY', fallback: 100, expected: 250 },
    { name: 'negative number returns fallback', env: { KEY: '-5' }, key: 'KEY', fallback: 100, expected: 100 },
    { name: 'negative number as number returns fallback', env: { KEY: -5 }, key: 'KEY', fallback: 100, expected: 100 },
    { name: 'NaN returns fallback', env: { KEY: 'not-a-number' }, key: 'KEY', fallback: 100, expected: 100 },
    { name: 'Infinity returns fallback', env: { KEY: 'Infinity' }, key: 'KEY', fallback: 100, expected: 100 },
    { name: '-Infinity returns fallback', env: { KEY: '-Infinity' }, key: 'KEY', fallback: 100, expected: 100 },
    { name: 'empty string returns fallback', env: { KEY: '' }, key: 'KEY', fallback: 100, expected: 100 },
    { name: 'whitespace string returns fallback', env: { KEY: '   ' }, key: 'KEY', fallback: 100, expected: 100 },
    { name: 'float value returns float', env: { KEY: '100.5' }, key: 'KEY', fallback: 100, expected: 100.5 },
    { name: 'large number returns value', env: { KEY: '999999999' }, key: 'KEY', fallback: 100, expected: 999999999 },
  ];

  for (const { name, env, key, fallback, expected } of unitTests) {
    test(name, () => {
      const result = resolveNonNegativeSetting(env, key, fallback);
      assert.strictEqual(result, expected);
    });
  }
});

// Real call-site integration: resolveWebCapability is a pure function whose observable
// output (maxUses / max_results) is produced by routing the env through the shared
// helper. These assertions fail if the site reverts to `Number(env) || literal`, which
// would coerce an explicit 0 back to the default — the exact regression o6t8.3 guards.

describe('resolveNonNegativeSetting integration: resolveWebCapability call site', () => {
  test('CONSTRUCT_WORKER_WEB_MAX_USES=0 flows through to grant.maxUses (explicit 0 honored)', () => {
    const grant = resolveWebCapability({ family: 'anthropic', env: { CONSTRUCT_WORKER_WEB_MAX_USES: '0' } });
    assert.strictEqual(grant.maxUses, 0);
  });

  test('CONSTRUCT_WORKER_WEB_MAX_USES=10 flows through to grant.maxUses', () => {
    const grant = resolveWebCapability({ family: 'anthropic', env: { CONSTRUCT_WORKER_WEB_MAX_USES: '10' } });
    assert.strictEqual(grant.maxUses, 10);
  });

  test('unset CONSTRUCT_WORKER_WEB_MAX_USES falls back to the default (5)', () => {
    const grant = resolveWebCapability({ family: 'anthropic', env: {} });
    assert.strictEqual(grant.maxUses, 5);
  });

  test('garbage CONSTRUCT_WORKER_WEB_MAX_USES falls back to the default (5)', () => {
    const grant = resolveWebCapability({ family: 'anthropic', env: { CONSTRUCT_WORKER_WEB_MAX_USES: 'lots' } });
    assert.strictEqual(grant.maxUses, 5);
  });

  test('CONSTRUCT_WORKER_WEB_MAX_RESULTS=0 flows through to the openrouter tool spec', () => {
    const grant = resolveWebCapability({ family: 'openrouter', env: { CONSTRUCT_WORKER_WEB_MAX_RESULTS: '0' } });
    assert.strictEqual(grant.toolSpec.parameters.max_results, 0);
  });

  test('CONSTRUCT_WORKER_WEB_MAX_RESULTS=20 flows through to the openrouter tool spec', () => {
    const grant = resolveWebCapability({ family: 'openrouter', env: { CONSTRUCT_WORKER_WEB_MAX_RESULTS: '20' } });
    assert.strictEqual(grant.toolSpec.parameters.max_results, 20);
  });
});
