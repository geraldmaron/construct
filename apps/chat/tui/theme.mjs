/**
 * apps/chat/tui/theme.mjs — pure presentation helpers for the Ink chat cockpit.
 *
 * Holds the colour palette, glyphs, the context-budget meter, the activity
 * spinner frames, and small formatters so the Ink components stay a thin
 * projection and the visual vocabulary is defined once. No React or Ink import,
 * so it is unit-testable and reused by every pane. Status is always carried by a
 * glyph as well as a colour, so meaning never depends on colour alone (WCAG).
 */

export const palette = {
  accent: 'cyan',
  accentAlt: 'magenta',
  ok: 'green',
  warn: 'yellow',
  danger: 'red',
  muted: 'gray',
  text: 'white',
};

export const glyphs = {
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

export const spinnerFrames = ['\u280b', '\u2819', '\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f'];

export function toolGlyph(status) {
  if (status === 'completed') return glyphs.toolDone;
  if (status === 'failed') return glyphs.toolFail;
  if (status === 'in_progress') return glyphs.toolBusy;
  return glyphs.toolPending;
}

export function toolColor(status) {
  if (status === 'completed') return palette.ok;
  if (status === 'failed') return palette.danger;
  if (status === 'in_progress') return palette.warn;
  return palette.muted;
}

// Split a router model id ("github-copilot/gpt-5.4") into provider and name so
// the header can dim the provider and emphasize the model.

export function splitModel(id) {
  if (!id) return { provider: '', name: '(no model)' };
  const idx = id.indexOf('/');
  if (idx === -1) return { provider: '', name: id };
  return { provider: id.slice(0, idx), name: id.slice(idx + 1) };
}

// A fixed-width fill bar for a used/size ratio. Only meaningful when the host
// reports a real context size; callers must not synthesize one (no-fabrication).

export function meter(used, size, width = 18) {
  const ratio = size > 0 ? Math.max(0, Math.min(1, used / size)) : 0;
  const filled = Math.round(ratio * width);
  return { bar: glyphs.block.repeat(filled) + glyphs.track.repeat(Math.max(0, width - filled)), ratio };
}

export function ratioColor(ratio) {
  if (ratio >= 0.85) return palette.danger;
  if (ratio >= 0.6) return palette.warn;
  return palette.ok;
}

export function percent(ratio) {
  return `${Math.round(ratio * 100)}%`;
}
