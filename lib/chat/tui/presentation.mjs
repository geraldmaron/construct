/**
 * lib/chat/tui/presentation.mjs — shared semantic presentation tokens for chat.
 *
 * Ink named colours and linear ANSI codes derive from one semantic map so the
 * rich and linear surfaces stay visually aligned across light and dark terminals.
 * Scheme resolution lives in color-scheme.mjs; ascii mode is passed to
 * createTheme() in apps/chat/tui/theme.mjs.
 */

import { shouldUseColor } from '../../term-format.mjs';
import { resolveTerminalColorScheme } from './color-scheme.mjs';

const ESC = '\u001b[';

const DARK_SEMANTIC = Object.freeze({
  text: { ink: 'white', code: '37' },
  muted: { ink: 'gray', code: '90' },
  accent: { ink: 'cyan', code: '36' },
  accentAlt: { ink: 'magenta', code: '35' },
  ok: { ink: 'green', code: '32' },
  warn: { ink: 'yellow', code: '33' },
  danger: { ink: 'red', code: '31' },
  badgeFg: { ink: 'black', code: '30' },
});

const LIGHT_SEMANTIC = Object.freeze({
  text: { ink: 'black', code: '30' },
  muted: { ink: 'gray', code: '90' },
  accent: { ink: 'blue', code: '34' },
  accentAlt: { ink: 'magenta', code: '35' },
  ok: { ink: 'green', code: '32' },
  warn: { ink: 'rgb(161,98,7)', code: '33' },
  danger: { ink: 'red', code: '31' },
  badgeFg: { ink: 'white', code: '97' },
});

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
  const scheme = explicitScheme || resolveTerminalColorScheme(env, configTheme);
  const useColor = shouldUseColor({ enabled, stream, env });
  const codes = chatAnsiCodes({ scheme });
  const reset = useColor ? `${ESC}0m` : '';
  const wrap = (code) => (useColor && code ? `${ESC}${code}m` : '');

  const colors = {
    scheme,
    reset,
    bold: wrap('1'),
    dim: wrap('2'),
    text: wrap(codes.text),
    muted: wrap(codes.muted),
    accent: wrap(codes.accent),
    accentAlt: wrap(codes.accentAlt),
    ok: wrap(codes.ok),
    warn: wrap(codes.warn),
    danger: wrap(codes.danger),
    badgeFg: wrap(codes.badgeFg),
    green: wrap(codes.ok),
    yellow: wrap(codes.warn),
    cyan: wrap(codes.accent),
    red: wrap(codes.danger),
  };

  return colors;
}

export { DARK_SEMANTIC, LIGHT_SEMANTIC };
