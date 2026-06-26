/**
 * lib/chat/tui/interactive-list-picker.mjs — searchable scrollable terminal list picker.
 *
 * Full-screen alternate buffer with type-to-filter and arrow-key navigation. Pauses
 * readline for the session, uses raw mode for keypress, then restores the main screen.
 */

import {
  createListPickerState,
  getPickerSelectedItem,
  getPickerVisibleItems,
  clampPickerIndex,
  reducePickerKey,
  windowPickerItems,
} from '../list-picker.mjs';
import { termWidth } from '../../term-format.mjs';

const ALT_ON = '\x1b[?1049h';
const ALT_OFF = '\x1b[?1049l';
const CLEAR_HOME = '\x1b[H\x1b[2J';

function normalizeKey(key, str) {
  if (str === '\u001b' || str === '\x1b') {
    return { escape: true };
  }
  if (!key) return {};
  return {
    escape: key.name === 'escape',
    return: key.name === 'return' || key.name === 'enter',
    upArrow: key.name === 'up',
    downArrow: key.name === 'down',
    backspace: key.name === 'backspace',
    delete: key.name === 'delete',
    ctrl: key.ctrl,
    meta: key.meta,
  };
}

function defaultFormatItem(item, { selected, colors }) {
  const marker = selected ? `${colors.green}▸${colors.reset}` : ' ';
  const label = item.label || item.id || '';
  const detail = item.detail ? ` ${colors.dim}— ${item.detail}${colors.reset}` : '';
  const disabled = item.disabled ? ` ${colors.dim}(unavailable)${colors.reset}` : '';
  return `${marker} ${colors.text}${label}${colors.reset}${detail}${disabled}`;
}

export function renderPickerScreen(state, colors, {
  title = 'select',
  width = 80,
  windowSize = 14,
  formatItem = defaultFormatItem,
} = {}) {
  const visible = getPickerVisibleItems(state);
  const clamped = clampPickerIndex({ ...state, items: visible });
  const index = clamped.index ?? 0;
  const { items: window, offset } = windowPickerItems(visible, index, windowSize);
  const lines = [];
  const rule = '─'.repeat(Math.max(20, Math.min(width - 2, 72)));

  lines.push(`${colors.bold}${title}${colors.reset}`);
  lines.push(`${colors.dim}${rule}${colors.reset}`);
  lines.push(`${colors.dim}type to filter · ↑↓ scroll · enter select · esc cancel${colors.reset}`);
  lines.push(`${colors.dim}filter:${colors.reset} ${state.query ? `${colors.text}${state.query}${colors.reset}` : colors.dim + '…' + colors.reset}`);
  lines.push('');

  if (!window.length) {
    lines.push(`${colors.dim}  no matches${colors.reset}`);
  } else {
    for (let i = 0; i < window.length; i += 1) {
      const item = window[i];
      const selected = offset + i === index;
      lines.push(formatItem(item, { selected, colors, width }));
    }
  }

  lines.push('');
  const total = visible.length;
  if (total) {
    const from = offset + 1;
    const to = offset + window.length;
    lines.push(`${colors.dim}${from}–${to} of ${total}${colors.reset}`);
  }

  return lines.join('\n');
}

export function runInteractiveListPicker({
  input,
  output,
  colors,
  title = 'select',
  items = [],
  selectedId = null,
  windowSize = 14,
  formatItem = defaultFormatItem,
} = {}) {
  if (!input?.isTTY || !output?.isTTY || !items.length) {
    return Promise.resolve(null);
  }

  const width = termWidth(output);
  let state = createListPickerState({ title, items, selectedId });
  let settled = false;

  return new Promise((resolve) => {
    const wasRaw = Boolean(input.isRaw);
    const wasPaused = typeof input.isPaused === 'function' && input.isPaused();
    if (wasPaused && typeof input.resume === 'function') {
      input.resume();
    }
    if (typeof input.setRawMode === 'function') {
      input.setRawMode(true);
    }

    const render = () => {
      output.write(CLEAR_HOME);
      output.write(renderPickerScreen(state, colors, { title, width, windowSize, formatItem }));
    };

    const finish = (item) => {
      if (settled) return;
      settled = true;
      input.removeListener('keypress', onKeypress);
      if (typeof input.setRawMode === 'function' && !wasRaw) {
        input.setRawMode(false);
      }
      output.write(ALT_OFF);
      resolve(item);
    };

    const onKeypress = (str, key) => {
      if (key?.ctrl && key.name === 'c') {
        finish(null);
        return;
      }
      const { state: next, action } = reducePickerKey(state, {
        char: str,
        key: normalizeKey(key, str),
      });
      if (action === 'cancel') {
        finish(null);
        return;
      }
      if (action === 'commit') {
        const item = getPickerSelectedItem(state);
        if (!item || item.disabled) {
          render();
          return;
        }
        finish(item);
        return;
      }
      state = next;
      render();
    };

    output.write(ALT_ON);
    render();
    input.on('keypress', onKeypress);
  });
}
