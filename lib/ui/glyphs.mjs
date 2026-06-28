/**
 * lib/ui/glyphs.mjs — single glyph registry for every construct surface.
 *
 * One source of truth for status marks, spinner frames, bullets, and box-drawing
 * characters, with an ASCII fallback for terminals that cannot render Unicode.
 * The CLI command surface and adapter diagnostics resolve glyphs here so they never
 * drift apart. Tool status marks map raw status strings to the registry.
 */

export const UNICODE_GLYPHS = Object.freeze({
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  bullet: '•',
  check: '✓',
  cross: '✗',
  arrow: '→',
  chevron: '›',
  dot: '·',
  diamond: '◆',
  play: '▸',
  boxH: '─',
  boxV: '│',
  boxTL: '╭',
  boxTR: '╮',
  boxBL: '╰',
  boxBR: '╯',
});

export const ASCII_GLYPHS = Object.freeze({
  spinner: ['|', '/', '-', '\\'],
  bullet: '*',
  check: 'OK',
  cross: 'X',
  arrow: '->',
  chevron: '>',
  dot: '.',
  diamond: '*',
  play: '>',
  boxH: '-',
  boxV: '|',
  boxTL: '+',
  boxTR: '+',
  boxBL: '+',
  boxBR: '+',
});

export function glyphs({ ascii = false } = {}) {
  return ascii ? ASCII_GLYPHS : UNICODE_GLYPHS;
}

// Tool lifecycle status resolves to a stable mark: done, failed, running, else
// pending. Callers pass the glyph set so ASCII terminals stay legible.

export function statusGlyph(status, set = UNICODE_GLYPHS) {
  if (status === 'completed') return set.check;
  if (status === 'failed') return set.cross;
  if (status === 'in_progress') return set.chevron;
  return set.dot;
}
