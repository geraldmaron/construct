/**
 * hosts/wiring/merge-toml.ts — add or read one `[mcp_servers.<name>]` table
 * in a host's TOML configuration without disturbing the rest of it.
 *
 * This is a narrow line reader, not a TOML parser. It understands table
 * headers, `key = value` lines, comments, and values that span lines inside
 * brackets or braces. A file that defines the server any other way (dotted
 * keys, an inline table) or uses multi-line strings is refused with its bytes
 * untouched, so it can never be corrupted by a form this module misreads.
 * Everything outside the server's own table keeps its exact bytes, line
 * endings included.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MergeResult } from './merge-mcp.ts';

export type TomlValue = string | number | boolean | readonly string[];

const SERVERS_TABLE = 'mcp_servers';

interface Line {
  /** The line without its terminator. */
  readonly text: string;
  /** The terminator exactly as the file has it: '\n', '\r\n', or '' at the end. */
  readonly eol: string;
}

type Shape =
  | { readonly kind: 'blank' }
  | { readonly kind: 'header'; readonly path: readonly string[]; readonly array: boolean }
  | { readonly kind: 'key'; readonly path: readonly string[]; readonly value: string }
  | { readonly kind: 'continuation'; readonly value: string };

interface Scanned {
  readonly lines: readonly Line[];
  readonly shapes: readonly Shape[];
  /** The table each line belongs to: the most recent header's path. */
  readonly tables: readonly (readonly string[])[];
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  for (const m of text.matchAll(/([^\n]*?)(\r?\n|$)/g)) {
    if (m[0] === '' && m.index === text.length) break;
    lines.push({ text: m[1]!, eol: m[2]! });
  }
  return lines;
}

const BARE_KEY = /^[A-Za-z0-9_-]+/;

function unescapeBasic(body: string): string | null {
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i]!;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = body[i + 1];
    const simple: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1b', '"': '"', '\\': '\\' };
    if (n !== undefined && simple[n] !== undefined) {
      out += simple[n];
      i += 1;
      continue;
    }
    const width = n === 'u' ? 4 : n === 'U' ? 8 : n === 'x' ? 2 : 0;
    const hex = body.slice(i + 2, i + 2 + width);
    if (width === 0 || !/^[0-9A-Fa-f]+$/.test(hex) || hex.length !== width) return null;
    out += String.fromCodePoint(Number.parseInt(hex, 16));
    i += 1 + width;
  }
  return out;
}

/** One quoted string at the start of `s`: its value and its length, or null. */
function readQuoted(s: string): { readonly value: string; readonly length: number } | null {
  if (s.startsWith("'")) {
    const end = s.indexOf("'", 1);
    return end < 0 ? null : { value: s.slice(1, end), length: end + 1 };
  }
  if (!s.startsWith('"')) return null;
  for (let i = 1; i < s.length; i += 1) {
    if (s[i] === '\\') {
      i += 1;
      continue;
    }
    if (s[i] === '"') {
      const value = unescapeBasic(s.slice(1, i));
      return value === null ? null : { value, length: i + 1 };
    }
  }
  return null;
}

/** A dotted key at the start of `s`, and what follows it. */
function readKeyPath(s: string): { readonly path: string[]; readonly rest: string } | null {
  const path: string[] = [];
  let rest = s.trimStart();
  for (;;) {
    const quoted = readQuoted(rest);
    if (quoted) {
      path.push(quoted.value);
      rest = rest.slice(quoted.length);
    } else {
      const bare = BARE_KEY.exec(rest);
      if (!bare) return null;
      path.push(bare[0]);
      rest = rest.slice(bare[0].length);
    }
    rest = rest.trimStart();
    if (!rest.startsWith('.')) return { path, rest };
    rest = rest.slice(1).trimStart();
  }
}

/**
 * The value text of one line with any comment removed, and how the line
 * changes bracket depth. Strings are skipped, so a '#' or '[' inside one
 * counts for nothing.
 */
function scanValue(s: string): { readonly value: string; readonly delta: number } | null {
  let delta = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '"' || c === "'") {
      const quoted = readQuoted(s.slice(i));
      if (!quoted) return null;
      i += quoted.length;
      continue;
    }
    if (c === '#') return { value: s.slice(0, i).trimEnd(), delta };
    if (c === '[' || c === '{') delta += 1;
    if (c === ']' || c === '}') delta -= 1;
    i += 1;
  }
  return { value: s.trimEnd(), delta };
}

function scan(text: string): Scanned | { readonly problem: string } {
  if (text.includes('"""') || text.includes("'''")) return { problem: 'the file uses multi-line strings, which Construct does not edit' };
  const lines = splitLines(text);
  const shapes: Shape[] = [];
  const tables: (readonly string[])[] = [];
  let table: readonly string[] = [];
  let depth = 0;
  for (const [index, line] of lines.entries()) {
    const trimmed = line.text.trim();
    const where = `line ${String(index + 1)}`;
    if (depth > 0) {
      const scanned = scanValue(line.text);
      if (!scanned) return { problem: `${where} has a string Construct cannot read` };
      depth += scanned.delta;
      shapes.push({ kind: 'continuation', value: scanned.value });
    } else if (trimmed === '' || trimmed.startsWith('#')) {
      shapes.push({ kind: 'blank' });
    } else if (trimmed.startsWith('[')) {
      const array = trimmed.startsWith('[[');
      const key = readKeyPath(trimmed.slice(array ? 2 : 1));
      const close = array ? ']]' : ']';
      if (!key || !key.rest.startsWith(close)) return { problem: `${where} is a table header Construct cannot read` };
      const after = key.rest.slice(close.length).trim();
      if (after !== '' && !after.startsWith('#')) return { problem: `${where} is a table header Construct cannot read` };
      table = key.path;
      shapes.push({ kind: 'header', path: key.path, array });
    } else {
      const key = readKeyPath(trimmed);
      if (!key || !key.rest.startsWith('=')) return { problem: `${where} is not a key and value Construct can read` };
      const scanned = scanValue(key.rest.slice(1).trim());
      if (!scanned) return { problem: `${where} has a string Construct cannot read` };
      depth = scanned.delta;
      shapes.push({ kind: 'key', path: key.path, value: scanned.value });
    }
    tables.push(table);
  }
  if (depth !== 0) return { problem: 'the file ends inside an unclosed array or table' };
  return { lines, shapes, tables };
}

function startsWith(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((p, i) => path[i] === p);
}

/** The lines that make up the server's own table: its header, its subtables, and their keys. */
function ownLines(s: Scanned, name: string): { readonly own: Set<number>; readonly first: number | null } | { readonly problem: string } {
  const prefix = [SERVERS_TABLE, name];
  const own = new Set<number>();
  let first: number | null = null;
  let inOwn = false;
  let lastContent = -1;
  for (const [i, shape] of s.shapes.entries()) {
    if (shape.kind === 'header') {
      if (startsWith(shape.path, prefix)) {
        if (shape.array) return { problem: `[[${SERVERS_TABLE}.${name}]] is an array of tables, which Construct does not edit` };
        // A subtable straight after the table's own keys takes the lines between them with it.
        if (inOwn) for (let j = lastContent + 1; j < i; j += 1) own.add(j);
        inOwn = true;
        first ??= i;
        own.add(i);
        lastContent = i;
      } else {
        inOwn = false;
      }
      continue;
    }
    if (shape.kind === 'key') {
      const full = [...s.tables[i]!, ...shape.path];
      if (!inOwn && startsWith(full, prefix)) return { problem: `${full.join('.')} defines the ${name} server with a dotted key or an inline table, which Construct does not edit` };
      if (!inOwn && full.length === 1 && full[0] === SERVERS_TABLE) return { problem: `${SERVERS_TABLE} is an inline table, which Construct does not edit` };
    }
    if (inOwn && shape.kind !== 'blank') {
      // A blank or comment line between two of the table's keys is the table's; trailing ones belong to what follows.
      for (let j = lastContent + 1; j <= i; j += 1) own.add(j);
      lastContent = i;
    }
  }
  return { own, first };
}

function parseStringArray(text: string): string[] | null {
  let rest = text.trim();
  if (!rest.startsWith('[') || !rest.endsWith(']')) return null;
  rest = rest.slice(1, -1).trim();
  const out: string[] = [];
  while (rest !== '') {
    const quoted = readQuoted(rest);
    if (!quoted) return null;
    out.push(quoted.value);
    rest = rest.slice(quoted.length).trim();
    if (rest.startsWith(',')) rest = rest.slice(1).trim();
    else if (rest !== '') return null;
  }
  return out;
}

const UNREADABLE = Symbol('unreadable');

function parseValue(text: string): TomlValue | typeof UNREADABLE {
  const t = text.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^[+-]?(?:0|[1-9](?:_?\d)*)$/.test(t)) return Number(t.replaceAll('_', ''));
  const quoted = readQuoted(t);
  if (quoted && quoted.length === t.length) return quoted.value;
  return parseStringArray(t) ?? UNREADABLE;
}

/**
 * The server table's keys, subtable keys dotted under it. A key whose value
 * is not a string, integer, boolean, or string array, or that sits in a
 * subtable or behind a dotted key, maps to UNREADABLE.
 */
function tableOf(s: Scanned, own: Set<number>): Map<string, TomlValue | typeof UNREADABLE> {
  const out = new Map<string, TomlValue | typeof UNREADABLE>();
  let pending: { key: string; value: string; readable: boolean } | null = null;
  const flush = (): void => {
    if (pending) out.set(pending.key, pending.readable ? parseValue(pending.value) : UNREADABLE);
    pending = null;
  };
  for (const i of [...own].sort((a, b) => a - b)) {
    const shape = s.shapes[i]!;
    if (shape.kind === 'header') {
      flush();
      if (shape.path.length > 2) out.set(shape.path.slice(2).join('.'), UNREADABLE);
    } else if (shape.kind === 'key') {
      flush();
      const table = s.tables[i]!;
      pending = { key: [...table.slice(2), ...shape.path].join('.'), value: shape.value, readable: table.length === 2 && shape.path.length === 1 };
    } else if (shape.kind === 'continuation' && pending) {
      pending.value += ` ${shape.value}`;
    }
  }
  flush();
  return out;
}

function quoteKey(name: string): string {
  return /^[A-Za-z0-9_-]+$/.test(name) ? name : basicString(name);
}

function basicString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else if (code < 0x20 || code === 0x7f) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

function renderValue(value: TomlValue): string | null {
  if (typeof value === 'string') return basicString(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : null;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return `[${value.map(basicString).join(', ')}]`;
  return null;
}

function renderTable(name: string, entry: Readonly<Record<string, TomlValue>>): string[] | null {
  const lines = [`[${SERVERS_TABLE}.${quoteKey(name)}]`];
  for (const [key, value] of Object.entries(entry)) {
    const rendered = renderValue(value);
    if (rendered === null) return null;
    lines.push(`${quoteKey(key)} = ${rendered}`);
  }
  return lines;
}

function sameTable(found: Map<string, TomlValue | typeof UNREADABLE>, entry: Readonly<Record<string, TomlValue>>): boolean {
  const keys = Object.keys(entry);
  if (found.size !== keys.length) return false;
  return keys.every((k) => {
    const have = found.get(k);
    const want = entry[k]!;
    if (have === undefined || have === UNREADABLE) return false;
    if (Array.isArray(want)) return Array.isArray(have) && have.length === want.length && want.every((v, i) => have[i] === v);
    return have === want;
  });
}

function read(path: string): { readonly kind: 'absent' } | { readonly kind: 'problem'; readonly problem: string } | { readonly kind: 'file'; readonly text: string; readonly scanned: Scanned } {
  if (!existsSync(path)) return { kind: 'absent' };
  const text = readFileSync(path, 'utf8');
  const scanned = scan(text);
  return 'problem' in scanned ? { kind: 'problem', problem: scanned.problem } : { kind: 'file', text, scanned };
}

export function mergeTomlServerTable(path: string, name: string, entry: Readonly<Record<string, TomlValue>>): MergeResult {
  const block = renderTable(name, entry);
  if (!block) return { ok: false, reason: 'the entry holds a value Construct does not write to TOML', path };
  const current = read(path);
  if (current.kind === 'problem') return { ok: false, reason: current.problem, path };
  let next: string;
  if (current.kind === 'absent') {
    next = `${block.join('\n')}\n`;
  } else {
    const s = current.scanned;
    const found = ownLines(s, name);
    if ('problem' in found) return { ok: false, reason: found.problem, path };
    const eol = s.lines.find((l) => l.eol !== '')?.eol ?? '\n';
    if (found.first !== null) {
      if (sameTable(tableOf(s, found.own), entry)) return { ok: true, created: false, path, replaced: [] };
      // The block ends without a line break only when it is the last thing in a file that ended without one.
      const last = s.lines.length - 1;
      const nothingKeptAfter = s.lines.every((_, i) => i <= found.first! || found.own.has(i));
      const end = nothingKeptAfter && s.lines[last]!.eol === '' ? '' : eol;
      const out: string[] = [];
      for (const [i, line] of s.lines.entries()) {
        if (i === found.first) out.push(block.join(eol) + end);
        if (!found.own.has(i)) out.push(line.text + line.eol);
      }
      next = out.join('');
    } else {
      const kept = current.text.replace(/(?:\r?\n)+$/, '');
      next = kept === '' ? `${block.join(eol)}${eol}` : `${kept}${eol}${eol}${block.join(eol)}${eol}`;
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next, 'utf8');
  try {
    chmodSync(path, 0o600);
  } catch {
    // platforms without modes
  }
  return { ok: true, created: current.kind === 'absent', path, replaced: [] };
}

/** The server's table as written, with only the values this module reads; null when the file has no such table. */
export function readTomlServerTable(path: string, name: string): Record<string, TomlValue> | null {
  const current = read(path);
  if (current.kind !== 'file') return null;
  const found = ownLines(current.scanned, name);
  if ('problem' in found || found.first === null) return null;
  const out: Record<string, TomlValue> = {};
  for (const [key, value] of tableOf(current.scanned, found.own)) {
    if (value !== UNREADABLE) out[key] = value;
  }
  return out;
}
