/**
 * tests/functional/chat-list-picker.functional.test.mjs — searchable list picker helpers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterPickerItems,
  createListPickerState,
  getPickerSelectedItem,
  reducePickerKey,
  movePickerIndex,
} from '../../lib/chat/list-picker.mjs';

test('filterPickerItems matches id, label, tag, and detail', () => {
  const items = [
    { id: 'openrouter/qwen/qwen3-coder:free', label: 'openrouter/qwen/qwen3-coder:free', tag: 'free' },
    { id: 'anthropic/claude-sonnet-4-6', label: 'anthropic/claude-sonnet-4-6', tag: 'cloud' },
  ];
  assert.equal(filterPickerItems(items, 'free').length, 1);
  assert.equal(filterPickerItems(items, 'claude').length, 1);
});

test('reducePickerKey supports search typing and arrow navigation', () => {
  let state = createListPickerState({
    kind: 'model',
    title: 'models',
    items: [
      { id: 'a', label: 'alpha' },
      { id: 'b', label: 'beta' },
      { id: 'c', label: 'copilot' },
    ],
  });
  ({ state } = reducePickerKey(state, { char: 'c' }));
  assert.equal(state.query, 'c');
  assert.equal(getPickerSelectedItem(state)?.id, 'c');
  state = movePickerIndex(state, 1);
  assert.ok(getPickerSelectedItem(state));
  const commit = reducePickerKey(state, { key: { return: true } });
  assert.equal(commit.action, 'commit');
});
