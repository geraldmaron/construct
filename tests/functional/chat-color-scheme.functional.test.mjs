/**
 * tests/functional/chat-color-scheme.functional.test.mjs — terminal theme detection.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  schemeFromColorFgBg,
  detectTerminalColorScheme,
  resolveTerminalColorScheme,
} from '../../lib/chat/tui/color-scheme.mjs';
import { inkPalette, resolveChatColors, createTheme } from '../../lib/chat/tui/presentation.mjs';

test('schemeFromColorFgBg detects light and dark backgrounds', () => {
  assert.equal(schemeFromColorFgBg('0;15'), 'light');
  assert.equal(schemeFromColorFgBg('15;0'), 'dark');
  assert.equal(schemeFromColorFgBg('7;0'), 'dark');
});

test('resolveTerminalColorScheme honors env override before detection', () => {
  assert.equal(resolveTerminalColorScheme({ CX_CHAT_THEME: 'light', COLORFGBG: '15;0' }), 'light');
  assert.equal(resolveTerminalColorScheme({ CX_CHAT_THEME: 'dark', COLORFGBG: '0;15' }), 'dark');
  assert.equal(resolveTerminalColorScheme({ COLORFGBG: '0;15' }, 'dark'), 'dark');
});

test('detectTerminalColorScheme falls back to dark without COLORFGBG', () => {
  assert.equal(detectTerminalColorScheme({}), 'dark');
});

test('inkPalette uses readable text color per scheme', () => {
  assert.equal(inkPalette({ scheme: 'dark' }).text, 'white');
  assert.equal(inkPalette({ scheme: 'light' }).text, 'black');
  assert.equal(inkPalette({ scheme: 'dark' }).accent, 'whiteBright');
});

test('createTheme and resolveChatColors stay aligned', () => {
  const theme = createTheme({ scheme: 'light', ascii: true });
  const colors = resolveChatColors({ env: { CX_CHAT_THEME: 'light' }, stream: { isTTY: false } });
  assert.equal(theme.scheme, 'light');
  assert.equal(theme.palette.text, 'black');
  assert.equal(colors.scheme, 'light');
});
