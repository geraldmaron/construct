/**
 * tests/ollama-installed-models.test.mjs — Ollama native id parsing and installed-tag checks.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toOllamaNativeModelId,
  formatOllamaModelMissingMessage,
  isOllamaModelInstalled,
  runWithInstalledOllamaCacheForTests,
} from '../lib/ollama/installed-models.mjs';
import { isModelAvailable } from '../lib/model-router.mjs';

test('toOllamaNativeModelId strips the ollama/ prefix once', () => {
  assert.equal(toOllamaNativeModelId('ollama/llama3.2:3b'), 'llama3.2:3b');
  assert.equal(toOllamaNativeModelId('llama3.2:3b'), 'llama3.2:3b');
});

test('formatOllamaModelMissingMessage includes pull commands', () => {
  const msg = formatOllamaModelMissingMessage('llama3.2:3b');
  assert.match(msg, /ollama pull llama3\.2:3b/);
  assert.match(msg, /construct ollama pull llama3\.2:3b/);
});

test('isOllamaModelInstalled uses cached tag list when listable', async () => {
  await runWithInstalledOllamaCacheForTests(['llama3.1:8b'], () => {
    assert.equal(isOllamaModelInstalled('ollama/llama3.1:8b'), true);
    assert.equal(isOllamaModelInstalled('ollama/llama3.2:3b'), false);
  });
});

test('isModelAvailable rejects unpulled ollama model when tags are listable', async () => {
  await runWithInstalledOllamaCacheForTests(['llama3.1:8b'], () => {
    const check = isModelAvailable('ollama/llama3.2:3b', {
      env: { OLLAMA_BASE_URL: 'http://127.0.0.1:11434' },
    });
    assert.equal(check.ok, false);
    assert.equal(check.reason, 'model_not_pulled');
    assert.equal(check.nativeModel, 'llama3.2:3b');
  });
});

test('isModelAvailable accepts installed ollama model when tags are listable', async () => {
  await runWithInstalledOllamaCacheForTests(['llama3.2:3b'], () => {
    const check = isModelAvailable('ollama/llama3.2:3b', {
      env: { OLLAMA_BASE_URL: 'http://127.0.0.1:11434' },
    });
    assert.equal(check.ok, true);
  });
});
