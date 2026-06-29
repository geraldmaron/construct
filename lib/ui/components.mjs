/**
 * lib/ui/components.mjs — branded line primitives shared across surfaces.
 *
 * Status lines and section labels drawn from the shared glyph registry and a
 * resolved color palette. Every primitive returns a string (never writes) so
 * callers compose freely, and degrades to plain labeled text when color is
 * unavailable so meaning never depends on a hue or glyph alone.
 */

import { UNICODE_GLYPHS } from './glyphs.mjs';

// A status line pairs a tinted glyph with a message. Tints map to semantic palette
// keys so success/warn/danger/info read consistently with the rest of the surface.

export function statusLine(message, { colors = {}, tint = 'muted', glyph = '•', indent = '  ' } = {}) {
  const color = colors[tint] || colors.muted || '';
  return `${indent}${color}${glyph}${colors.reset || ''}  ${message}`;
}

export function ok(message, { colors = {}, glyphs = UNICODE_GLYPHS } = {}) {
  return statusLine(message, { colors, tint: 'ok', glyph: glyphs.check });
}

export function warn(message, { colors = {} } = {}) {
  return statusLine(message, { colors, tint: 'warn', glyph: '⚠' });
}

export function info(message, { colors = {}, glyphs = UNICODE_GLYPHS } = {}) {
  return statusLine(message, { colors, tint: 'highlight', glyph: glyphs.arrow });
}

export function fail(message, { colors = {}, glyphs = UNICODE_GLYPHS } = {}) {
  return statusLine(message, { colors, tint: 'danger', glyph: glyphs.cross });
}

// A section label is a tinted glyph plus a heading that opens a logical block in
// flowing command output, lighter than a full box.

export function section(label, { colors = {}, tint = 'highlight', glyph = '▸' } = {}) {
  const color = colors[tint] || colors.highlight || '';
  return `${color}${colors.bold || ''}${glyph} ${label}${colors.reset || ''}`;
}
