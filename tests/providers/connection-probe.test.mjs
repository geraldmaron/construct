/**
 * tests/providers/connection-probe.test.mjs — hermetic LLM provider credential probe.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { probeProviderConnection } from '../../lib/providers/connection-probe.mjs';

test('probeProviderConnection reports missing API keys without fetching', async () => {
  let fetched = false;
  const result = await probeProviderConnection('openrouter', {
    env: {},
    allowAmbient: false,
    fetch: async () => {
      fetched = true;
      return { status: 200 };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'missing_key');
  assert.equal(fetched, false);
});

test('probeProviderConnection classifies provider auth responses', async () => {
  const ok = await probeProviderConnection('anthropic', {
    env: { ANTHROPIC_API_KEY: 'sk-test' },
    allowAmbient: false,
    fetch: async (_url, request) => {
      assert.equal(request.headers['x-api-key'], 'sk-test');
      assert.equal(request.headers['anthropic-version'], '2023-06-01');
      return { status: 200 };
    },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.code, 'ok');

  const denied = await probeProviderConnection('openai', {
    env: { OPENAI_API_KEY: 'sk-test' },
    allowAmbient: false,
    fetch: async () => ({ status: 401 }),
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'auth_error');
});

