/**
 * lib/chat/web-picker-keys.mjs — keyboard routing for the web list picker.
 *
 * Arrow/enter/escape handling shared with Ink via list-picker.mjs; this module
 * adapts DOM KeyboardEvent shapes for tests and the React overlay.
 */

import {
  getPickerSelectedItem,
  getPickerVisibleItems,
  movePickerIndex,
  reducePickerKey,
} from './list-picker.mjs';

export { getPickerSelectedItem, getPickerVisibleItems, movePickerIndex };

export function domKeyToPickerKey(event) {
  const key = event?.key || '';
  return {
    char: key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey ? key : undefined,
    key: {
      escape: key === 'Escape',
      return: key === 'Enter',
      upArrow: key === 'ArrowUp',
      downArrow: key === 'ArrowDown',
      backspace: key === 'Backspace',
      delete: key === 'Delete',
      ctrl: event.ctrlKey,
      meta: event.metaKey,
    },
  };
}

export function isPickerNavigationKey(key) {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'Enter' || key === 'Escape';
}

export function reduceWebPickerKey(state, event) {
  return reducePickerKey(state, domKeyToPickerKey(event));
}

export function commitWebPickerSelection(state) {
  const item = getPickerSelectedItem(state);
  if (!item || item.disabled) return { ok: false, item: null };
  return { ok: true, item };
}
