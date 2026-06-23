/**
 * tests/functional/chat-design-tokens.functional.test.mjs — chat brand token wiring.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FONTS, INK } from '../../lib/brand-tokens.mjs';
import { chatCssVars, chatPalette, CHAT_DARK } from '../../lib/chat/design-tokens.mjs';

test('FONTS.sans uses Space Grotesk stack', () => {
  assert.match(FONTS.sans, /Space Grotesk/);
});

test('chatCssVars exposes brand typography and ink palette', () => {
  const vars = chatCssVars('dark');
  assert.equal(vars['--cx-chat-font'], FONTS.sans);
  assert.equal(vars['--cx-chat-mono'], FONTS.mono);
  assert.equal(vars['--cx-chat-bg'], CHAT_DARK.bg);
  assert.equal(vars['--cx-chat-border'], INK.muted);
});

test('chatPalette dark scheme uses monochrome accent not violet', () => {
  const p = chatPalette('dark');
  assert.equal(p.accent, '#ffffff');
  assert.notEqual(p.accent, '#8b5cf6');
});
