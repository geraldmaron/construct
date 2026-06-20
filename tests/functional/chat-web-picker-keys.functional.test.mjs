/**
 * tests/functional/chat-web-picker-keys.functional.test.mjs — web picker keyboard routing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createListPickerState } from '../../lib/chat/list-picker.mjs';
import {
  commitWebPickerSelection,
  domKeyToPickerKey,
  isPickerNavigationKey,
  reduceWebPickerKey,
} from '../../lib/chat/web-picker-keys.mjs';

const ITEMS = [
  { id: '__free_router__', label: 'free router', disabled: true },
  { id: 'ollama/a', label: 'ollama/a' },
  { id: 'ollama/b', label: 'ollama/b' },
];

test('domKeyToPickerKey maps arrow and enter events', () => {
  const down = domKeyToPickerKey({ key: 'ArrowDown', ctrlKey: false, metaKey: false, altKey: false });
  assert.equal(down.key.downArrow, true);
  assert.equal(down.char, undefined);
  const letter = domKeyToPickerKey({ key: 'c', ctrlKey: false, metaKey: false, altKey: false });
  assert.equal(letter.char, 'c');
});

test('reduceWebPickerKey moves off disabled rows and commits enabled selection', () => {
  let state = createListPickerState({
    kind: 'model',
    title: 'models',
    items: ITEMS,
  });
  assert.equal(state.index, 1);

  ({ state } = reduceWebPickerKey(state, { key: 'ArrowDown' }));
  assert.equal(state.index, 2);

  ({ state } = reduceWebPickerKey(state, { key: 'ArrowUp' }));
  assert.equal(state.index, 1);

  const commit = reduceWebPickerKey(state, { key: 'Enter' });
  assert.equal(commit.action, 'commit');
  const picked = commitWebPickerSelection(commit.state);
  assert.equal(picked.ok, true);
  assert.equal(picked.item.id, 'ollama/a');
});

test('isPickerNavigationKey excludes typing keys', () => {
  assert.equal(isPickerNavigationKey('ArrowDown'), true);
  assert.equal(isPickerNavigationKey('a'), false);
});
