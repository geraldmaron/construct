/**
 * tests/functional/chat-openrouter-fallback.functional.test.mjs — OpenRouter fallback helpers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOpenRouterError,
  recordFailedModel,
  getExcludeList,
  shouldAttemptFreeFallback,
  handleOpenRouterFailure,
} from '../../lib/chat/openrouter-fallback.mjs';

test('parseOpenRouterError extracts rate-limit metadata', () => {
  const raw = '{"error":{"message":"Provider returned error","metadata":{"raw":"google/gemma-4-26b-a4b-it:free is temporarily rate-limited upstream"}}}';
  const parsed = parseOpenRouterError(raw);
  assert.match(parsed.summary, /rate-limited|gemma-4/i);
});

test('recordFailedModel tracks exclude list on session', () => {
  const session = {};
  recordFailedModel(session, 'openrouter/a:free');
  recordFailedModel(session, 'openrouter/b:free');
  assert.deepEqual(getExcludeList(session).sort(), ['openrouter/a:free', 'openrouter/b:free']);
});

test('shouldAttemptFreeFallback for router mode and pinned free slugs', () => {
  assert.equal(shouldAttemptFreeFallback({ modelMode: 'free-router' }, 'openrouter/x'), true);
  assert.equal(shouldAttemptFreeFallback({ modelMode: 'pinned' }, 'openrouter/x:free'), true);
  assert.equal(shouldAttemptFreeFallback({ modelMode: 'pinned' }, 'anthropic/claude-sonnet-4-6'), false);
});

test('handleOpenRouterFailure picks next model when poll returns candidates', async () => {
  const session = { modelMode: 'free-router', failedModels: new Set(['openrouter/openrouter/google/gemma-4-26b-a4b-it:free']) };
  const original = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: [
        {
          id: 'google/gemma-4-26b-a4b-it:free',
          name: 'Gemma 4',
          context_length: 32000,
          pricing: { prompt: '0', completion: '0' },
          architecture: { output_modalities: ['text'] },
        },
        {
          id: 'qwen/qwen3-coder:free',
          name: 'Qwen3 Coder',
          context_length: 32000,
          pricing: { prompt: '0', completion: '0' },
          architecture: { output_modalities: ['text'] },
        },
      ],
    }),
  });

  try {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    const result = await handleOpenRouterFailure({
      session,
      error: '429 rate limit on google/gemma-4-26b-a4b-it:free',
      env: process.env,
      currentModel: 'openrouter/google/gemma-4-26b-a4b-it:free',
    });
    assert.ok(result);
    assert.equal(result.modelId, 'openrouter/qwen/qwen3-coder:free');
    assert.match(result.notice, /Switched to/);
  } finally {
    global.fetch = original;
    delete process.env.OPENROUTER_API_KEY;
  }
});
