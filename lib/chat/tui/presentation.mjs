/**
 * lib/chat/tui/presentation.mjs — shared semantic presentation tokens for chat.
 *
 * Ink named colours and linear ANSI codes derive from one semantic map so the
 * rich and linear surfaces stay visually aligned. Presentation only — no config
 * persistence lives here; ascii mode is resolved in config/cli and passed to
 * createTheme() in apps/chat/tui/theme.mjs.
 */

export const SEMANTIC = Object.freeze({
  accent: { ink: 'cyan', code: '36' },
  accentAlt: { ink: 'magenta', code: '35' },
  ok: { ink: 'green', code: '32' },
  warn: { ink: 'yellow', code: '33' },
  danger: { ink: 'red', code: '31' },
  muted: { ink: 'gray', code: '2' },
  text: { ink: 'white', code: '37' },
});

export function inkPalette() {
  return Object.fromEntries(Object.entries(SEMANTIC).map(([k, v]) => [k, v.ink]));
}

export function chatAnsiCodes() {
  return Object.fromEntries(Object.entries(SEMANTIC).map(([k, v]) => [k, v.code]));
}
