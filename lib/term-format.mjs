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
const ANSI_TOKEN_RE = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\]8;;.*?(?:\x07|\x1b\\)/gs;

const CODES = { bold: "1", dim: "2", reset: "0", red: "31", green: "32", yellow: "33", cyan: "36" };

const PALETTE_KEYS = Object.keys(CODES);

const EMPTY_PALETTE = Object.freeze(Object.fromEntries(PALETTE_KEYS.map((k) => [k, ""])));
const GRAPHEME_SEGMENTER = globalThis.Intl?.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
const ZERO_WIDTH_RE = /^(?:\p{Mark}|\p{Control}|\p{Format})$/u;

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

function graphemes(text) {
  const value = String(text);
  if (!value) return [];
  if (!GRAPHEME_SEGMENTER) return [...value];
  return Array.from(GRAPHEME_SEGMENTER.segment(value), (segment) => segment.segment);
}

function isFullwidthCodePoint(codePoint) {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
    (codePoint >= 0x1f680 && codePoint <= 0x1f6ff) ||
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function graphemeWidth(grapheme) {
  const value = String(grapheme);
  if (!value) return 0;
  if (!GRAPHEME_SEGMENTER && value.length === 1) {
    const codePoint = value.codePointAt(0);
    if (codePoint === undefined) return 0;
    if (ZERO_WIDTH_RE.test(value)) return 0;
    return isFullwidthCodePoint(codePoint) ? 2 : 1;
  }
  if ([...value].every((char) => ZERO_WIDTH_RE.test(char))) return 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined && isFullwidthCodePoint(codePoint)) return 2;
  }
  return 1;
}

export function displayWidth(text) {
  let width = 0;
  for (const token of graphemes(stripAnsi(text))) width += graphemeWidth(token);
  return width;
}

export function clipToWidth(text, width) {
  const input = String(text);
  if (width <= 0 || input === "") return "";
  if (displayWidth(input) <= width) return input;

  const parts = [];
  let visible = 0;
  let searchIndex = 0;
  let sawAnsi = false;
  let openHyperlink = false;

  for (const match of input.matchAll(ANSI_TOKEN_RE)) {
    const token = match[0];
    const index = match.index ?? searchIndex;
    const chunk = input.slice(searchIndex, index);
    for (const grapheme of graphemes(chunk)) {
      const nextWidth = graphemeWidth(grapheme);
      if (visible + nextWidth > width) {
        if (sawAnsi) parts.push("\x1b[0m");
        if (openHyperlink) parts.push("\x1b]8;;\x07");
        return parts.join("");
      }
      parts.push(grapheme);
      visible += nextWidth;
    }

    parts.push(token);
    sawAnsi = true;
    if (token.startsWith("\x1b]8;;")) openHyperlink = token !== "\x1b]8;;\x07" && token !== "\x1b]8;;\x1b\\";
    searchIndex = index + token.length;
  }

  const tail = input.slice(searchIndex);
  for (const grapheme of graphemes(tail)) {
    const nextWidth = graphemeWidth(grapheme);
    if (visible + nextWidth > width) {
      if (sawAnsi) parts.push("\x1b[0m");
      if (openHyperlink) parts.push("\x1b]8;;\x07");
      return parts.join("");
    }
    parts.push(grapheme);
    visible += nextWidth;
  }

  return parts.join("");
}

export function padToWidth(text, width) {
  const input = String(text);
  const padding = Math.max(0, width - displayWidth(input));
  return padding ? `${input}${" ".repeat(padding)}` : input;
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
      } else if (displayWidth(line) + 1 + displayWidth(word) <= width) {
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
  return String(text).replace(ANSI_TOKEN_RE, "");
}
