/**
 * lib/embed/config.mjs — embed mode configuration schema and loader.
 *
 * Reads embed.yaml from the project root (or a supplied path) and validates
 * it against the expected schema. Returns a parsed, normalized config object.
 *
 * Schema:
 *
 *   sources:
 *     - provider: github          # registered provider name
 *       refs: [prs, issues]       # read refs to poll
 *       intervalMs: 60000         # poll interval (default: 60000)
 *
 *   outputs:
 *     - type: markdown            # write snapshot to a file
 *       path: .cx/snapshot.md
 *     - type: slack               # post to a Slack channel
 *       provider: slack
 *       channel: C12345
 *     - type: dashboard           # push to the Construct dashboard
 *
 *   approval:
 *     require:                    # action types that need approval before dispatch
 *       - issue.create
 *       - pr.merge
 *     timeout_ms: 3600000         # how long to wait before auto-expiring (default: 1h)
 *     fallback: reject            # reject | proceed (default: reject)
 *
 *   snapshot:
 *     intervalMs: 300000          # how often to regenerate full snapshot (default: 5m)
 *     maxItems: 100               # max items per source in snapshot
 */

import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  snapshot: { intervalMs: 300_000, maxItems: 100 },
  approval: { require: [], timeout_ms: 3_600_000, fallback: 'reject' },
};

export function loadEmbedConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Embed config not found: ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  // Minimal YAML subset parser: handles the flat-ish schema we use.
  // Full YAML parsing requires a dep; we use a hand-rolled parser for zero-dep core.
  const parsed = parseEmbedYaml(raw);
  return normalize(parsed);
}

export function normalize(raw) {
  const config = {
    sources: [],
    outputs: [],
    snapshot: { ...DEFAULTS.snapshot, ...(raw.snapshot ?? {}) },
    approval: { ...DEFAULTS.approval, ...(raw.approval ?? {}) },
  };

  for (const src of raw.sources ?? []) {
    if (!src.provider) throw new Error('Each source must have a "provider" field');
    config.sources.push({
      provider: src.provider,
      refs: Array.isArray(src.refs) ? src.refs : [src.refs ?? 'status'],
      intervalMs: src.intervalMs ?? 60_000,
    });
  }

  for (const out of raw.outputs ?? []) {
    if (!out.type) throw new Error('Each output must have a "type" field');
    config.outputs.push({ ...out });
  }

  return config;
}

/**
 * Hand-rolled parser for the embed YAML schema.
 * Supports: top-level keys, nested objects, lists of objects, scalar values.
 * Not a general YAML parser — only handles what embed.yaml uses.
 */
export function parseEmbedYaml(text) {
  const lines = text.split('\n');
  const root = {};
  let i = 0;

  function peek() { return lines[i]; }
  function advance() { return lines[i++]; }
  function indent(line) { return line.match(/^(\s*)/)[1].length; }
  function isComment(line) { return line.trimStart().startsWith('#'); }
  function isEmpty(line) { return line.trim() === ''; }

  function parseValue(val) {
    const v = val.trim();
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v === 'null' || v === '~') return null;
    const n = Number(v);
    if (!Number.isNaN(n) && v !== '') return n;
    // Strip quotes
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1);
    }
    return v;
  }

  function parseBlock(baseIndent) {
    const obj = {};
    while (i < lines.length) {
      const line = peek();
      if (isEmpty(line) || isComment(line)) { advance(); continue; }
      const lineIndent = indent(line);
      if (lineIndent < baseIndent) break;
      if (lineIndent > baseIndent) { advance(); continue; } // skip malformed

      advance();
      const trimmed = line.trim();

      // List item
      if (trimmed.startsWith('- ')) {
        // Not expected at block level — handled by parseList
        break;
      }

      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      const rest = trimmed.slice(colonIdx + 1);

      if (rest.trim() === '') {
        // Next lines are either a list or nested object
        const nextLine = lines[i];
        if (!nextLine) { obj[key] = null; continue; }
        const nextTrimmed = nextLine.trimStart();
        if (nextTrimmed.startsWith('- ')) {
          obj[key] = parseList(lineIndent + 2);
        } else {
          obj[key] = parseBlock(lineIndent + 2);
        }
      } else {
        obj[key] = parseValue(rest);
      }
    }
    return obj;
  }

  function parseList(baseIndent) {
    const arr = [];
    while (i < lines.length) {
      const line = peek();
      if (isEmpty(line) || isComment(line)) { advance(); continue; }
      const lineIndent = indent(line);
      if (lineIndent < baseIndent) break;

      const trimmed = line.trim();
      if (!trimmed.startsWith('- ')) break;
      advance();

      const rest = trimmed.slice(2).trim();
      if (rest === '') {
        // Multi-line list item object
        arr.push(parseBlock(lineIndent + 2));
      } else if (rest.includes(':')) {
        // Inline object in list: "- provider: github"
        const item = {};
        const colonIdx = rest.indexOf(':');
        const key = rest.slice(0, colonIdx).trim();
        const val = rest.slice(colonIdx + 1).trim();
        item[key] = val === '' ? parseBlock(lineIndent + 2) : parseValue(val);
        // Consume continuation keys at same level
        while (i < lines.length) {
          const next = lines[i];
          if (isEmpty(next) || isComment(next)) { i++; continue; }
          if (indent(next) <= lineIndent) break;
          i++;
          const nt = next.trim();
          const ci = nt.indexOf(':');
          if (ci === -1) continue;
          const nk = nt.slice(0, ci).trim();
          const nv = nt.slice(ci + 1).trim();
          if (nv === '') {
            const nextNext = lines[i];
            if (nextNext && nextNext.trimStart().startsWith('- ')) {
              item[nk] = parseList(indent(next) + 2);
            } else {
              item[nk] = parseBlock(indent(next) + 2);
            }
          } else {
            item[nk] = parseValue(nv);
          }
        }
        arr.push(item);
      } else {
        arr.push(parseValue(rest));
      }
    }
    return arr;
  }

  return parseBlock(0);
}

export function defaultEmbedConfigPath(projectRoot) {
  return path.join(projectRoot, 'embed.yaml');
}
