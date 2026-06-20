/**
 * tests/functional/chat-ollama-fallback.functional.test.mjs — turn-time fallback when
 * a pinned Ollama tag is not pulled locally.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTurnInto } from '../../lib/chat/tui/turn-state.mjs';
import {
  handleOllamaNotPulledFailure,
  handleModelFailure,
  isOllamaNotPulledError,
  runTurnWithFallback,
} from '../../lib/chat/openrouter-fallback.mjs';
import {
  resetInstalledOllamaModelsCacheForTests,
  setInstalledOllamaModelsCacheForTests,
} from '../../lib/ollama/installed-models.mjs';

function withIsolatedHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-ollama-fb-'));
  const prior = process.env.HOME;
  process.env.HOME = home;
  try {
    return fn(home);
  } finally {
    process.env.HOME = prior;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function ollamaMissingMessage(native = 'llama3.2:3b') {
  return `Ollama model '${native}' is not installed locally. Pull it with: ollama pull ${native} (or: construct ollama pull ${native})`;
}

function modelSwitchingDriver(failModel, okModel) {
  return {
    prompt(_text, opts = {}) {
      const model = opts.model;
      return (async function* events() {
        if (model === failModel) {
          yield { type: 'error', message: ollamaMissingMessage('llama3.2:3b') };
          yield { type: 'done', stopReason: 'error' };
          return;
        }
        if (model === okModel) {
          yield { type: 'text', text: 'fallback answer' };
          yield { type: 'done', stopReason: 'end_turn' };
          return;
        }
        yield { type: 'error', message: `unexpected model ${model}` };
        yield { type: 'done', stopReason: 'error' };
      })();
    },
  };
}

test('isOllamaNotPulledError recognizes preflight and API messages', () => {
  assert.equal(isOllamaNotPulledError(ollamaMissingMessage()), true);
  assert.equal(isOllamaNotPulledError({ code: 'OLLAMA_MODEL_NOT_PULLED', message: 'x' }), true);
  assert.equal(isOllamaNotPulledError('429 rate limit'), false);
});

test('handleOllamaNotPulledFailure picks next configured provider', async () => {
  withIsolatedHome(() => {
    resetInstalledOllamaModelsCacheForTests();
    setInstalledOllamaModelsCacheForTests(['llama3.1:8b']);
    const env = { ANTHROPIC_API_KEY: 'sk-test' };
    return handleOllamaNotPulledFailure({
      session: {},
      error: ollamaMissingMessage(),
      env,
      currentModel: 'ollama/llama3.2:3b',
    }).then((result) => {
      assert.ok(result);
      assert.equal(result.modelId, 'anthropic/claude-sonnet-4-6');
      assert.match(result.notice, /Switched to anthropic\/claude-sonnet-4-6/);
      resetInstalledOllamaModelsCacheForTests();
    });
  });
});

test('runTurnWithFallback completes turn on provider after unpulled ollama', async () => {
  withIsolatedHome(async () => {
    resetInstalledOllamaModelsCacheForTests();
    setInstalledOllamaModelsCacheForTests(['llama3.1:8b']);
    const env = { ANTHROPIC_API_KEY: 'sk-test' };
    const session = {
      model: 'ollama/llama3.2:3b',
      savedModel: 'ollama/llama3.2:3b',
      modelMode: 'pinned',
      modelNotice: 'Pinned ollama/llama3.2:3b — not installed locally. Using anthropic/claude-sonnet-4-6.',
      failedModels: new Set(),
    };
    const driver = modelSwitchingDriver('ollama/llama3.2:3b', 'anthropic/claude-sonnet-4-6');

    const { state, model, notice } = await runTurnWithFallback({
      driver,
      text: 'hello',
      session,
      layers: {},
      env,
      runTurnInto,
    });

    assert.equal(state.error, null);
    assert.equal(state.assistant, 'fallback answer');
    assert.equal(model, 'anthropic/claude-sonnet-4-6');
    assert.match(notice, /Switched to anthropic\/claude-sonnet-4-6/);
    assert.equal(session.model, 'anthropic/claude-sonnet-4-6');
    resetInstalledOllamaModelsCacheForTests();
  });
});

test('configuredTierPickerItems marks unpulled ollama models disabled', async () => {
  resetInstalledOllamaModelsCacheForTests();
  setInstalledOllamaModelsCacheForTests(['llama3.1:8b']);
  const { configuredTierPickerItems } = await import('../../lib/chat/model-picker.mjs');
  const env = { OLLAMA_BASE_URL: 'http://127.0.0.1:11434' };
  const { items } = configuredTierPickerItems({ env });
  const missing = items.find((item) => item.id === 'ollama/llama3.2:3b');
  assert.ok(missing, 'expected fast-tier ollama default in picker items');
  assert.equal(missing.disabled, true);
  assert.match(missing.detail, /not installed/i);
  resetInstalledOllamaModelsCacheForTests();
});

test('handleModelFailure prefers OpenRouter retry before ollama provider switch', async () => {
  const session = { modelMode: 'free-router', failedModels: new Set() };
  const original = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: [{
        id: 'qwen/qwen3-coder:free',
        name: 'Qwen3 Coder',
        context_length: 32000,
        pricing: { prompt: '0', completion: '0' },
        architecture: { output_modalities: ['text'] },
      }],
    }),
  });

  try {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    const result = await handleModelFailure({
      session,
      error: '429 rate limit on google/gemma:free',
      env: process.env,
      currentModel: 'openrouter/google/gemma:free',
    });
    assert.ok(result);
    assert.equal(result.modelId, 'openrouter/qwen/qwen3-coder:free');
  } finally {
    global.fetch = original;
    delete process.env.OPENROUTER_API_KEY;
  }
});
