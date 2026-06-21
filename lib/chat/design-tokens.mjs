/**
 * lib/chat/design-tokens.mjs — semantic chat tokens derived from brand primitives.
 *
 * Maps lib/brand-tokens.mjs ink ramp to dark/light chat surfaces for web CSS vars
 * and terminal semantic colours. Single source for cockpit theming across linear
 * and web/desktop surfaces.
 */

import { INK, FONTS, STATUS } from '../brand-tokens.mjs';

export const CHAT_DARK = Object.freeze({
  bg: '#000000',
  surface: '#0b0b0c',
  border: INK.muted,
  text: '#ededed',
  muted: '#9a9a9e',
  accent: '#ffffff',
  accentAlt: INK.hairlineStrong,
  ...STATUS,
});

export const CHAT_LIGHT = Object.freeze({
  bg: '#f8f9fb',
  surface: INK.surfaceAlt,
  border: INK.hairlineStrong,
  text: INK.ink,
  muted: INK.muted,
  accent: INK.inkStrong,
  accentAlt: INK.muted,
  ok: '#15803d',
  warn: '#a16207',
  danger: STATUS.danger,
});

const TERMINAL_DARK = Object.freeze({
  text: { ink: 'white', code: '37' },
  muted: { ink: 'gray', code: '90' },
  accent: { ink: 'whiteBright', code: '97' },
  accentAlt: { ink: 'gray', code: '90' },
  brandAccent: { ink: 'whiteBright', code: '97' },
  surface: { ink: 'gray', code: '90' },
  surfaceMuted: { ink: 'gray', code: '90' },
  border: { ink: 'gray', code: '90' },
  ok: { ink: 'green', code: '32' },
  warn: { ink: 'yellow', code: '33' },
  danger: { ink: 'red', code: '31' },
  badgeFg: { ink: 'black', code: '30' },
});

const TERMINAL_LIGHT = Object.freeze({
  text: { ink: 'black', code: '30' },
  muted: { ink: 'gray', code: '90' },
  accent: { ink: 'black', code: '30' },
  accentAlt: { ink: 'gray', code: '90' },
  brandAccent: { ink: 'black', code: '30' },
  surface: { ink: 'gray', code: '90' },
  surfaceMuted: { ink: 'gray', code: '90' },
  border: { ink: 'gray', code: '90' },
  ok: { ink: 'green', code: '32' },
  warn: { ink: 'rgb(161,98,7)', code: '33' },
  danger: { ink: 'red', code: '31' },
  badgeFg: { ink: 'white', code: '97' },
});

export function chatPalette(scheme = 'dark') {
  return scheme === 'light' ? CHAT_LIGHT : CHAT_DARK;
}

export function chatCssVars(scheme = 'dark') {
  const p = chatPalette(scheme);
  return {
    '--cx-chat-bg': p.bg,
    '--cx-chat-surface': p.surface,
    '--cx-chat-border': p.border,
    '--cx-chat-text': p.text,
    '--cx-chat-muted': p.muted,
    '--cx-chat-accent': p.accent,
    '--cx-chat-accent-alt': p.accentAlt,
    '--cx-chat-warn': p.warn,
    '--cx-chat-danger': p.danger,
    '--cx-chat-ok': p.ok,
    '--cx-chat-font': FONTS.sans,
    '--cx-chat-mono': FONTS.mono,
  };
}

export function chatTerminalSemantic(scheme = 'dark') {
  return scheme === 'light' ? TERMINAL_LIGHT : TERMINAL_DARK;
}

export { FONTS, INK, STATUS };
