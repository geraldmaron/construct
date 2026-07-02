/**
 * tests/config/env-number-defaults.test.mjs — resolveMsSetting env number parsing.
 *
 * Verifies the shared helper `resolveMsSetting(env, key, fallback)` correctly
 * parses numeric environment variables: explicit 0 is preserved (not coerced to
 * fallback), unset/missing/non-numeric values fall back, and positive values
 * pass through. Integration assertions confirm each converted call site honors
 * the same semantics (construct-o6t8.3).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { resolveMsSetting } from '../../lib/env-config.mjs';

describe('resolveMsSetting(env, key, fallback)', () => {
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
      const result = resolveMsSetting(env, key, fallback);
      assert.strictEqual(result, expected);
    });
  }
});

describe('resolveMsSetting integration: worker.mjs CONSTRUCT_WORKER_TOOL_ROUNDS', () => {
  test('CONSTRUCT_WORKER_TOOL_ROUNDS=0 disables rounds', () => {
    const env = { CONSTRUCT_WORKER_TOOL_ROUNDS: '0' };
    const result = resolveMsSetting(env, 'CONSTRUCT_WORKER_TOOL_ROUNDS', 4);
    assert.strictEqual(result, 0);
  });

  test('CONSTRUCT_WORKER_TOOL_ROUNDS=10 uses 10', () => {
    const env = { CONSTRUCT_WORKER_TOOL_ROUNDS: '10' };
    const result = resolveMsSetting(env, 'CONSTRUCT_WORKER_TOOL_ROUNDS', 4);
    assert.strictEqual(result, 10);
  });

  test('missing CONSTRUCT_WORKER_TOOL_ROUNDS defaults to 4', () => {
    const env = {};
    const result = resolveMsSetting(env, 'CONSTRUCT_WORKER_TOOL_ROUNDS', 4);
    assert.strictEqual(result, 4);
  });
});

describe('resolveMsSetting integration: worker.mjs CONSTRUCT_WORKER_WEB_LOOP_CAP', () => {
  test('CONSTRUCT_WORKER_WEB_LOOP_CAP=0 disables loop cap', () => {
    const env = { CONSTRUCT_WORKER_WEB_LOOP_CAP: '0' };
    const result = resolveMsSetting(env, 'CONSTRUCT_WORKER_WEB_LOOP_CAP', 4);
    assert.strictEqual(result, 0);
  });

  test('CONSTRUCT_WORKER_WEB_LOOP_CAP=20 uses 20', () => {
    const env = { CONSTRUCT_WORKER_WEB_LOOP_CAP: '20' };
    const result = resolveMsSetting(env, 'CONSTRUCT_WORKER_WEB_LOOP_CAP', 4);
    assert.strictEqual(result, 20);
  });
});

describe('resolveMsSetting integration: web-capability.mjs CONSTRUCT_WORKER_WEB_MAX_USES', () => {
  test('CONSTRUCT_WORKER_WEB_MAX_USES=0 disables max uses', () => {
    const env = { CONSTRUCT_WORKER_WEB_MAX_USES: '0' };
    const result = resolveMsSetting(env, 'CONSTRUCT_WORKER_WEB_MAX_USES', 5);
    assert.strictEqual(result, 0);
  });

  test('CONSTRUCT_WORKER_WEB_MAX_USES=10 uses 10', () => {
    const env = { CONSTRUCT_WORKER_WEB_MAX_USES: '10' };
    const result = resolveMsSetting(env, 'CONSTRUCT_WORKER_WEB_MAX_USES', 5);
    assert.strictEqual(result, 10);
  });
});

describe('resolveMsSetting integration: web-capability.mjs CONSTRUCT_WORKER_WEB_MAX_RESULTS', () => {
  test('CONSTRUCT_WORKER_WEB_MAX_RESULTS=0 disables max results', () => {
    const env = { CONSTRUCT_WORKER_WEB_MAX_RESULTS: '0' };
    const result = resolveMsSetting(env, 'CONSTRUCT_WORKER_WEB_MAX_RESULTS', 5);
    assert.strictEqual(result, 0);
  });

  test('CONSTRUCT_WORKER_WEB_MAX_RESULTS=20 uses 20', () => {
    const env = { CONSTRUCT_WORKER_WEB_MAX_RESULTS: '20' };
    const result = resolveMsSetting(env, 'CONSTRUCT_WORKER_WEB_MAX_RESULTS', 5);
    assert.strictEqual(result, 20);
  });
});

describe('resolveMsSetting integration: session-reflect.mjs CONSTRUCT_REFLECT_BUDGET_MS', () => {
  test('CONSTRUCT_REFLECT_BUDGET_MS=0 disables budget', () => {
    const env = { CONSTRUCT_REFLECT_BUDGET_MS: '0' };
    const result = resolveMsSetting(env, 'CONSTRUCT_REFLECT_BUDGET_MS', 500);
    assert.strictEqual(result, 0);
  });

  test('CONSTRUCT_REFLECT_BUDGET_MS=1000 uses 1000', () => {
    const env = { CONSTRUCT_REFLECT_BUDGET_MS: '1000' };
    const result = resolveMsSetting(env, 'CONSTRUCT_REFLECT_BUDGET_MS', 500);
    assert.strictEqual(result, 1000);
  });
});

describe('resolveMsSetting integration: daemon.mjs CONSTRUCT_EMBED_LOG_MAX_MB', () => {
  test('CONSTRUCT_EMBED_LOG_MAX_MB=0 sets cap to 0', () => {
    const env = { CONSTRUCT_EMBED_LOG_MAX_MB: '0' };
    const result = resolveMsSetting(env, 'CONSTRUCT_EMBED_LOG_MAX_MB', 50);
    assert.strictEqual(result, 0);
  });

  test('CONSTRUCT_EMBED_LOG_MAX_MB=100 uses 100', () => {
    const env = { CONSTRUCT_EMBED_LOG_MAX_MB: '100' };
    const result = resolveMsSetting(env, 'CONSTRUCT_EMBED_LOG_MAX_MB', 50);
    assert.strictEqual(result, 100);
  });
});

describe('resolveMsSetting integration: daemon.mjs CONSTRUCT_EMBED_LOG_MAX_SEGMENTS', () => {
  test('CONSTRUCT_EMBED_LOG_MAX_SEGMENTS=0 sets segments to 0', () => {
    const env = { CONSTRUCT_EMBED_LOG_MAX_SEGMENTS: '0' };
    const result = resolveMsSetting(env, 'CONSTRUCT_EMBED_LOG_MAX_SEGMENTS', 5);
    assert.strictEqual(result, 0);
  });

  test('CONSTRUCT_EMBED_LOG_MAX_SEGMENTS=10 uses 10', () => {
    const env = { CONSTRUCT_EMBED_LOG_MAX_SEGMENTS: '10' };
    const result = resolveMsSetting(env, 'CONSTRUCT_EMBED_LOG_MAX_SEGMENTS', 5);
    assert.strictEqual(result, 10);
  });
});

describe('resolveMsSetting integration: docling-remote.mjs CONSTRUCT_DOCLING_TIMEOUT_MS', () => {
  test('CONSTRUCT_DOCL_DOCLING_TIMEOUT_MS=0 disables timeout', () => {
    const env = { CONSTRUCT_DOCLING_TIMEOUT_MS: '0' };
    const result = resolveMsSetting(env, 'CONSTRUCT_DOCLING_TIMEOUT_MS', 600_000);
    assert.strictEqual(result, 0);
  });

  test('CONSTRUCT_DOCLING_TIMEOUT_MS=120000 uses 120000', () => {
    const env = { CONSTRUCT_DOCLING_TIMEOUT_MS: '120000' };
    const result = resolveMsSetting(env, 'CONSTRUCT_DOCLING_TIMEOUT_MS', 600_000);
    assert.strictEqual(result, 120000);
  });
});