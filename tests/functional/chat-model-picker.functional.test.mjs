/**
 * tests/functional/chat-model-picker.functional.test.mjs — model picker helpers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sortModelsForPicker,
  pickerStartIndex,
  FREE_ROUTER_ITEM_ID,
  FOLLOW_TIER_ITEM_ID,
  configuredTierPickerItems,
} from '../../lib/chat/model-picker.mjs';
import { windowPickerItems } from '../../lib/chat/list-picker.mjs';

test('sortModelsForPicker prefers free router and free models', () => {
  const ordered = sortModelsForPicker([
    { id: 'a', suitable: true },
    { id: 'openrouter/x:free', isFree: true, suitable: true },
    { id: FREE_ROUTER_ITEM_ID, action: 'free-router', label: 'router' },
  ]);
  assert.equal(ordered[0].id, FREE_ROUTER_ITEM_ID);
});

test('windowPickerItems centers selection in the viewport', () => {
  const models = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}` }));
  const { items, offset } = windowPickerItems(models, 10, 8);
  assert.equal(items.length, 8);
  assert.ok(offset >= 6 && offset <= 10);
  assert.ok(items.some((m) => m.id === 'm10'));
});

test('pickerStartIndex selects current model when present', () => {
  const models = [{ id: 'a' }, { id: 'b' }];
  assert.equal(pickerStartIndex(models, 'b'), 1);
  assert.equal(pickerStartIndex(models, 'missing'), 0);
});

test('loadModelPickerItems groups live provider models with capability badges', async () => {
  const { loadModelPickerItems } = await import('../../lib/chat/model-picker.mjs');

  const pollProviders = async () => ([
    { id: 'anthropic', label: 'Anthropic', live: true, models: [
      { id: 'anthropic/claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'anthropic', free: false, pricing: { input: 15, output: 75 }, context: 200000, reasoning: true, tools: true, vision: true, source: 'live' },
    ] },
    { id: 'ollama', label: 'Ollama (local)', live: true, models: [
      { id: 'ollama/llama3.1:8b', label: 'llama3.1:8b', provider: 'ollama', free: true, pricing: { input: 0, output: 0 }, context: null, reasoning: false, tools: false, vision: false, source: 'live' },
    ] },
  ]);

  const items = await loadModelPickerItems(null, { env: {}, pollProviders });

  assert.equal(items[0].id, FOLLOW_TIER_ITEM_ID, 'tier-following stays on top');
  assert.equal(items[1].id, FREE_ROUTER_ITEM_ID, 'free-router remains directly available');
  const opus = items.find((i) => i.id === 'anthropic/claude-opus-4-8');
  assert.ok(opus, 'anthropic model present');
  assert.equal(opus.group, 'Anthropic');
  assert.deepEqual(opus.badges, ['reasoning', 'vision', 'tools']);
  assert.match(opus.price, /\$15\.00 in/);

  const llama = items.find((i) => i.id === 'ollama/llama3.1:8b');
  assert.ok(llama, 'ollama model present');
  assert.equal(llama.group, 'Ollama (local)');
  assert.equal(llama.tag, 'free');
});

test('loadModelPickerItems drops known tool-incapable models but keeps unknown ones', async () => {
  const { loadModelPickerItems } = await import('../../lib/chat/model-picker.mjs');

  const pollProviders = async () => ([
    { id: 'openrouter', label: 'OpenRouter', live: true, models: [
      // provider reported no tool support → the chat loop would always error → filtered
      { id: 'openrouter/meta-llama/llama-3.2-3b-instruct:free', label: 'Llama 3.2 3B', provider: 'openrouter', free: true, pricing: { input: 0, output: 0 }, reasoning: false, tools: false, toolsKnown: true, vision: false, source: 'live' },
      // tool-capable → kept
      { id: 'openrouter/qwen/qwen3-coder:free', label: 'Qwen3 Coder', provider: 'openrouter', free: true, pricing: { input: 0, output: 0 }, reasoning: true, tools: true, toolsKnown: true, vision: false, source: 'live' },
    ] },
    { id: 'ollama', label: 'Ollama (local)', live: true, models: [
      // tool support unknown for a local tag → stays selectable
      { id: 'ollama/llama3.1:8b', label: 'llama3.1:8b', provider: 'ollama', free: true, pricing: { input: 0, output: 0 }, reasoning: false, tools: false, toolsKnown: false, vision: false, source: 'live' },
    ] },
  ]);

  const items = await loadModelPickerItems(null, { env: {}, pollProviders });
  const ids = items.map((i) => i.id);

  assert.ok(!ids.includes('openrouter/meta-llama/llama-3.2-3b-instruct:free'), 'known tool-incapable model is filtered out');
  assert.ok(ids.includes('openrouter/qwen/qwen3-coder:free'), 'tool-capable allowlisted model is kept');
  assert.ok(ids.includes('ollama/llama3.1:8b'), 'unknown-capability local model is kept');
});

test('configuredTierPickerItems only includes tier defaults from configured providers', async () => {
  const { getProviderModelCatalog } = await import('../../lib/model-router.mjs');
  const { items } = configuredTierPickerItems({ env: process.env });
  const configured = getProviderModelCatalog({ env: process.env }).providers.filter((p) => p.configured);
  assert.ok(items.length <= configured.length * 3);
  for (const item of items) {
    assert.ok(configured.some((p) => [p.tiers.reasoning, p.tiers.standard, p.tiers.fast].includes(item.id)));
  }
});
