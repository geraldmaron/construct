/**
 * lib/chat/list-picker.mjs — searchable list picker for construct chat Ink.
 *
 * Pure state/helpers for arrow-key overlays: type-to-filter, windowed viewport,
 * and selection index clamping. Used by model, setting, and permission pickers.
 */

export function filterPickerItems(items = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const hay = [item.id, item.label, item.detail, item.tag]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

export function pickerStartIndex(items, selectedId, idKey = 'id') {
  if (!items?.length) return 0;
  const idx = items.findIndex((item) => item[idKey] === selectedId);
  return idx >= 0 ? idx : 0;
}

export function windowPickerItems(items, index, windowSize = 12) {
  if (!items?.length) return { items: [], offset: 0 };
  const size = Math.max(5, windowSize);
  let start = Math.max(0, index - Math.floor(size / 2));
  if (start + size > items.length) start = Math.max(0, items.length - size);
  return { items: items.slice(start, start + size), offset: start };
}

export function clampPickerIndex(state) {
  const visible = filterPickerItems(state.items, state.query);
  const max = Math.max(0, visible.length - 1);
  return { ...state, index: Math.min(state.index, max) };
}

export function createListPickerState({
  kind, title, items, selectedId = null, context = null, query = '',
} = {}) {
  const visible = filterPickerItems(items, query);
  return {
    kind,
    title,
    items,
    query,
    index: pickerStartIndex(visible, selectedId),
    context,
  };
}

export function getPickerVisibleItems(state) {
  return filterPickerItems(state?.items || [], state?.query || '');
}

export function getPickerSelectedItem(state) {
  const visible = getPickerVisibleItems(state);
  return visible[state?.index ?? 0] || null;
}

export function movePickerIndex(state, delta) {
  const visible = getPickerVisibleItems(state);
  if (!visible.length) return state;
  const next = Math.max(0, Math.min(visible.length - 1, (state.index ?? 0) + delta));
  return { ...state, index: next };
}

export function appendPickerQuery(state, char) {
  if (!char) return state;
  return clampPickerIndex({ ...state, query: `${state.query || ''}${char}`, index: 0 });
}

export function backspacePickerQuery(state) {
  return clampPickerIndex({ ...state, query: (state.query || '').slice(0, -1), index: 0 });
}

export function reducePickerKey(state, { char, key } = {}) {
  if (!state) return { state: null, action: 'none' };
  if (key?.escape) return { state: null, action: 'cancel' };
  if (key?.return) return { state, action: 'commit' };
  if (key?.upArrow) return { state: movePickerIndex(state, -1), action: 'none' };
  if (key?.downArrow) return { state: movePickerIndex(state, 1), action: 'none' };
  if (key?.backspace || key?.delete) return { state: backspacePickerQuery(state), action: 'none' };
  if (char && !key?.ctrl && !key?.meta) return { state: appendPickerQuery(state, char), action: 'none' };
  return { state, action: 'none' };
}

export function pickerViewport(state, windowSize = 14) {
  const visible = getPickerVisibleItems(state);
  const clamped = clampPickerIndex({ ...state, items: visible });
  return windowPickerItems(visible, clamped.index, windowSize);
}
