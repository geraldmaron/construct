/**
 * lib/chat/tui/presentation.mjs — shared semantic presentation tokens for chat.
 *
 * Ink named colours and linear ANSI codes derive from one semantic map so the
 * rich and linear surfaces stay visually aligned across light and dark terminals.
 * Scheme resolution lives in color-scheme.mjs.
 */

import { shouldUseColor } from '../../term-format.mjs';
import { chatTerminalSemantic } from '../design-tokens.mjs';
import { resolveTerminalColorScheme } from './color-scheme.mjs';

const ESC = '\u001b[';

const ASCII_GLYPHS = Object.freeze({
  spinner: ['|', '/', '-', '\\'],
  bullet: '*',
  check: 'OK',
  cross: 'X',
  arrow: '->',
  boxH: '-',
  boxV: '|',
});

const UNICODE_GLYPHS = Object.freeze({
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  bullet: '•',
  check: '✓',
  cross: '✗',
  arrow: '→',
  boxH: '─',
  boxV: '│',
});

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
    surface: wrap(codes.surface),
    surfaceMuted: wrap(codes.surfaceMuted),
    border: wrap(codes.border),
    brandAccent: wrap(codes.brandAccent),
    highlight: wrap(codes.highlight),
    heading: wrap(codes.heading),
    emphasis: wrap(codes.emphasis),
    code: wrap(codes.code),
    link: wrap(codes.link),
    panel: wrap(codes.panel),
    green: wrap(codes.ok),
    yellow: wrap(codes.warn),
    cyan: wrap(codes.highlight),
    red: wrap(codes.danger),
  };

  return colors;
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
