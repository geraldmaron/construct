/**
 * lib/jsonc.mjs — tolerant JSON-with-comments parser.
 *
 * Construct's user-facing config (construct.config.json) is authored like
 * tsconfig.json: strict-JSON body plus `//` and block comments carrying piped
 * option hints (mode: solo|team|enterprise), and forgiving of a trailing comma.
 * A single string-safe scanner strips comments (without touching `//` or `/*`
 * sequences that live inside string values), then a trailing-comma pass makes
 * the result strict JSON for JSON.parse. Extracted so every config reader shares
 * one implementation rather than each host adapter reinventing it.
 */

export function stripJsonComments(raw) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < raw.length && raw[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

export function parseJsonc(raw) {
  return JSON.parse(stripJsonComments(raw).replace(/,(\s*[}\]])/g, "$1"));
}
