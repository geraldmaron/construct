/**
 * apps/chat/tui/theme.mjs — pure presentation helpers for the Ink chat cockpit.
 *
 * Holds the colour palette, glyphs, the context-budget meter, the activity
 * spinner frames, and small formatters so the Ink components stay a thin
 * projection and the visual vocabulary is defined once. Semantic colours come
 * from lib/chat/tui/presentation.mjs; createTheme({ ascii }) swaps Unicode
 * glyphs for ASCII-safe fallbacks when config or CX_CHAT_ASCII requests it.
 */

import { inkPalette } from '../../../lib/chat/tui/presentation.mjs';

const UNICODE_GLYPHS = {
  brand: '\u25c6',
  dot: '\u25cf',
  arrow: '\u2192',
  caret: '\u25b8',
  gutter: '\u2502',
  block: '\u2588',
  track: '\u2591',
  toolDone: '\u2713',
  toolFail: '\u2717',
  toolBusy: '\u25b8',
  toolPending: '\u00b7',
};

const ASCII_GLYPHS = {
  brand: '*',
  dot: 'o',
  arrow: '->',
  caret: '>',
  gutter: '|',
  block: '#',
  track: '-',
  toolDone: '+',
  toolFail: 'x',
  toolBusy: '>',
  toolPending: '.',
};

const BRAILLE_SPINNER = ['\u280b', '\u2819', '\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f'];
const ASCII_SPINNER = ['|', '/', '-', '\\'];

const DEFAULT_THEME = createTheme({ ascii: false });

export const palette = DEFAULT_THEME.palette;
export const glyphs = DEFAULT_THEME.glyphs;
export const spinnerFrames = DEFAULT_THEME.spinnerFrames;

export function createTheme({ ascii = false } = {}) {
  return {
    palette: inkPalette(),
    glyphs: ascii ? { ...ASCII_GLYPHS } : { ...UNICODE_GLYPHS },
    spinnerFrames: ascii ? [...ASCII_SPINNER] : [...BRAILLE_SPINNER],
  };
}

export function toolGlyph(status, theme = DEFAULT_THEME) {
  const g = theme.glyphs;
  if (status === 'completed') return g.toolDone;
  if (status === 'failed') return g.toolFail;
  if (status === 'in_progress') return g.toolBusy;
  return g.toolPending;
}

export function toolColor(status, theme = DEFAULT_THEME) {
  const p = theme.palette;
  if (status === 'completed') return p.ok;
  if (status === 'failed') return p.danger;
  if (status === 'in_progress') return p.warn;
  return p.muted;
}

export function splitModel(id) {
  if (!id) return { provider: '', name: '(no model)' };
  const idx = id.indexOf('/');
  if (idx === -1) return { provider: '', name: id };
  return { provider: id.slice(0, idx), name: id.slice(idx + 1) };
}

export function meter(used, size, width = 18, theme = DEFAULT_THEME) {
  const g = theme.glyphs;
  const ratio = size > 0 ? Math.max(0, Math.min(1, used / size)) : 0;
  const filled = Math.round(ratio * width);
  return { bar: g.block.repeat(filled) + g.track.repeat(Math.max(0, width - filled)), ratio };
}

export function ratioColor(ratio, theme = DEFAULT_THEME) {
  const p = theme.palette;
  if (ratio >= 0.85) return p.danger;
  if (ratio >= 0.6) return p.warn;
  return p.ok;
}

export function percent(ratio) {
  return `${Math.round(ratio * 100)}%`;
}
