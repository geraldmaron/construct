/**
 * lib/term-format.mjs — single source of truth for human-facing terminal presentation.
 *
 * Centralizes terminal color enable/disable and width so accessibility behavior
 * (NO_COLOR, non-TTY pipes, TERM=dumb, narrow terminals) is decided in one tested place
 * instead of being re-implemented per call site. Presentation only: this module never
 * touches machine-readable output (`--json`, parsed hook tokens, registries, contracts) —
 * callers keep those paths away from here. See rules/common/neurodivergent-output.md.
 */

const ESC = "[";

const CODES = { bold: "1", dim: "2", reset: "0", red: "31", green: "32", yellow: "33", cyan: "36" };

const PALETTE_KEYS = Object.keys(CODES);

const EMPTY_PALETTE = Object.freeze(Object.fromEntries(PALETTE_KEYS.map((k) => [k, ""])));

// Color is opt-in by the caller AND gated on an interactive, color-capable stream. Any
// NO_COLOR value and TERM=dumb force plain text; a non-TTY stream (pipe, file, CI) does too.

export function shouldUseColor({ enabled = true, stream = process.stdout, env = process.env } = {}) {
  return Boolean(enabled) && Boolean(stream && stream.isTTY) && !env.NO_COLOR && env.TERM !== "dumb";
}

// A palette is the full key set whether or not color is on, so callers can interpolate
// every field unconditionally; when color is off each field is the empty string.

export function palette(useColor) {
  if (!useColor) return EMPTY_PALETTE;
  return Object.fromEntries(PALETTE_KEYS.map((k) => [k, `${ESC}${CODES[k]}m`]));
}

export function resolveColors(opts = {}) {
  return palette(shouldUseColor(opts));
}

// Wrapping width for human prose. Falls back to 80 when the stream width is unknown
// (non-TTY, redirected) and caps wide terminals so lines stay scannable rather than long.

export function termWidth(stream = process.stdout, { fallback = 80, max = 100 } = {}) {
  const cols = stream && Number.isInteger(stream.columns) ? stream.columns : fallback;
  return Math.min(cols, max);
}

// Word-wrap one paragraph to width. Existing newlines stay as hard breaks; a single word
// longer than width is never split — it sits on its own line and overflows rather than
// becoming two unreadable fragments.

export function wrapText(text, width = termWidth()) {
  const out = [];
  for (const hardLine of String(text).split("\n")) {
    if (hardLine === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of hardLine.split(/\s+/)) {
      if (line === "") {
        line = word;
      } else if (line.length + 1 + word.length <= width) {
        line += ` ${word}`;
      } else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

export function stripAnsi(text) {
  return String(text).replace(/\[[0-9;]*m/g, "");
}
