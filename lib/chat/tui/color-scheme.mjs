/**
 * lib/chat/tui/color-scheme.mjs — terminal light/dark detection for construct chat.
 *
 * Resolves auto|light|dark from CX_CHAT_THEME, saved ui.theme, and COLORFGBG
 * (macOS Terminal, iTerm, Linux VTE, Windows Terminal). Falls back to dark when
 * the background cannot be inferred — set CX_CHAT_THEME=light on legacy Windows
 * conhost if needed.
 */

const THEME_VALUES = new Set(['auto', 'light', 'dark']);

export function schemeFromColorFgBg(value) {
  const parts = String(value).split(';').map((p) => parseInt(p, 10)).filter((n) => !Number.isNaN(n));
  if (!parts.length) return null;
  const bg = parts.length >= 2 ? parts[1] : parts[parts.length - 1];
  if (bg === 7 || bg === 15) return 'light';
  if (bg >= 0 && bg <= 6) return 'dark';
  if (bg === 8) return 'dark';
  if (bg >= 9 && bg <= 14) return 'light';
  return null;
}

export function detectTerminalColorScheme(env = process.env) {
  const fromFgBg = env.COLORFGBG ? schemeFromColorFgBg(env.COLORFGBG) : null;
  if (fromFgBg) return fromFgBg;
  return 'dark';
}

export function resolveTerminalColorScheme(env = process.env, configTheme = null) {
  const envTheme = String(env.CX_CHAT_THEME || env.CONSTRUCT_CHAT_THEME || '').trim().toLowerCase();
  if (envTheme === 'light' || envTheme === 'dark') return envTheme;

  const saved = String(configTheme || '').trim().toLowerCase();
  if (saved === 'light' || saved === 'dark') return saved;

  return detectTerminalColorScheme(env);
}

export function normalizeThemeSetting(value) {
  const v = String(value || 'auto').trim().toLowerCase();
  return THEME_VALUES.has(v) ? v : null;
}
