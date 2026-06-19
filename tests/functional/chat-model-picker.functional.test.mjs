/**
 * tests/functional/chat-model-picker.functional.test.mjs — model picker helpers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sortModelsForPicker,
  pickerStartIndex,
  FREE_ROUTER_ITEM_ID,
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

test('loadModelPickerItems stays smaller than the full static catalog', async () => {
  const { loadModelPickerItems } = await import('../../lib/chat/model-picker.mjs');
  const { getProviderModelCatalog } = await import('../../lib/model-router.mjs');
  const catalogIds = new Set(
    getProviderModelCatalog({ env: {} }).providers.flatMap((provider) => [
      ...provider.options.reasoning,
      ...provider.options.standard,
      ...provider.options.fast,
    ]),
  );
  const items = await loadModelPickerItems(null, { env: {} });
  assert.ok(items.length < catalogIds.size);
  assert.ok(items.length <= 40);
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
