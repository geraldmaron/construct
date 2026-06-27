/**
 * lib/chat/tui/presentation.mjs — shared semantic presentation tokens for chat.
 *
 * Ink named colours and linear ANSI codes derive from one semantic map so the
 * rich and linear surfaces stay visually aligned across light and dark terminals.
 * Scheme resolution lives in color-scheme.mjs.
 */

import { resolveUiColors } from '../../ui/theme.mjs';
import { chatTerminalSemantic } from '../design-tokens.mjs';
import { resolveTerminalColorScheme } from './color-scheme.mjs';
import { ASCII_GLYPHS, UNICODE_GLYPHS } from '../../ui/glyphs.mjs';

const DARK_SEMANTIC = Object.freeze(chatTerminalSemantic('dark'));
const LIGHT_SEMANTIC = Object.freeze(chatTerminalSemantic('light'));

function semanticForScheme(scheme = 'dark') {
  return scheme === 'light' ? LIGHT_SEMANTIC : DARK_SEMANTIC;
}

export function inkPalette({ scheme = 'dark' } = {}) {
  const semantic = semanticForScheme(scheme);
  return Object.fromEntries(Object.entries(semantic).map(([k, v]) => [k, v.ink]));
}

export function chatAnsiCodes({ scheme = 'dark' } = {}) {
  const semantic = semanticForScheme(scheme);
  return Object.fromEntries(Object.entries(semantic).map(([k, v]) => [k, v.code]));
}

export function resolveChatColors({
  enabled = true,
  stream = process.stdout,
  env = process.env,
  scheme: explicitScheme = null,
  configTheme = null,
} = {}) {
  return resolveUiColors({ enabled, stream, env, scheme: explicitScheme, configTheme });
}

export function createTheme({ scheme = 'dark', ascii = false, env = process.env, configTheme = null } = {}) {
  const resolvedScheme = scheme || resolveTerminalColorScheme(env, configTheme);
  return {
    scheme: resolvedScheme,
    palette: inkPalette({ scheme: resolvedScheme }),
    glyphs: ascii ? ASCII_GLYPHS : UNICODE_GLYPHS,
  };
}

export { DARK_SEMANTIC, LIGHT_SEMANTIC };
