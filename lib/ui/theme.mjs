/**
 * lib/ui/theme.mjs — shared semantic color resolution for every construct surface.
 *
 * Surface-neutral palette for the CLI and generated adapter diagnostics.
 * Terminal codes are basic 16-color SGR, which renders on every
 * terminal including macOS Terminal.app; the truecolor guard degrades any 24-bit
 * value so no raw escape leaks where the terminal cannot honor it.
 */

import { shouldUseColor } from '../term-format.mjs';

const ESC = '[';

function resolveTerminalColorScheme(env = process.env, configTheme = null) {
  const explicit = String(configTheme || env.CONSTRUCT_COLOR_SCHEME || '').toLowerCase();
  if (explicit === 'light' || explicit === 'dark') return explicit;
  const termProgram = String(env.TERM_PROGRAM || '').toLowerCase();
  if (termProgram.includes('apple_terminal')) return 'light';
  return 'dark';
}

function terminalSemantic(scheme) {
  const dark = scheme !== 'light';
  return {
    text: { code: dark ? '97' : '30' },
    muted: { code: dark ? '90' : '90' },
    accent: { code: dark ? '96' : '36' },
    accentAlt: { code: dark ? '95' : '35' },
    ok: { code: dark ? '92' : '32' },
    warn: { code: dark ? '93' : '33' },
    danger: { code: dark ? '91' : '31' },
    badgeFg: { code: dark ? '30' : '97' },
    surface: { code: dark ? '40' : '47' },
    surfaceMuted: { code: dark ? '100' : '47' },
    border: { code: dark ? '90' : '90' },
    brandAccent: { code: dark ? '97' : '30' },
    highlight: { code: dark ? '96' : '36' },
    heading: { code: dark ? '97' : '30' },
    emphasis: { code: dark ? '93' : '33' },
    code: { code: dark ? '92' : '32' },
    link: { code: dark ? '94' : '34' },
    panel: { code: dark ? '90' : '90' },
  };
}

// COLORTERM=truecolor|24bit advertises 24-bit support. Terminal.app sets neither
// and tops out at 256 colors, so absent the flag we treat the stream as non-truecolor.

export function supportsTrueColor(env = process.env) {
  const flag = String(env.COLORTERM || '').toLowerCase();
  return flag === 'truecolor' || flag === '24bit';
}

// SGR codes from design-tokens are already basic 16-color (30-37/90-97). A 24-bit
// sequence (38;2;r;g;b) only survives when the terminal advertises truecolor;
// otherwise it is dropped to dim so meaning never rides on an unrenderable color.

function degradeCode(code, trueColor) {
  if (!code) return code;
  if (/^38;2;/.test(String(code)) && !trueColor) return '2';
  return code;
}

export function resolveUiColors({
  enabled = true,
  stream = process.stdout,
  env = process.env,
  scheme: explicitScheme = null,
  configTheme = null,
} = {}) {
  const scheme = explicitScheme || resolveTerminalColorScheme(env, configTheme);
  const useColor = shouldUseColor({ enabled, stream, env });
  const trueColor = supportsTrueColor(env);
  const semantic = terminalSemantic(scheme);
  const codes = Object.fromEntries(Object.entries(semantic).map(([k, v]) => [k, degradeCode(v.code, trueColor)]));
  const reset = useColor ? `${ESC}0m` : '';
  const wrap = (code) => (useColor && code ? `${ESC}${code}m` : '');

  return {
    scheme,
    reset,
    bold: wrap('1'),
    dim: wrap('2'),
    underline: wrap('4'),
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
}
