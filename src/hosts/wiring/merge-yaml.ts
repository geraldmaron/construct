/**
 * hosts/wiring/merge-yaml.ts — add or read one `mcp_servers.<name>` block in
 * a host's YAML configuration without disturbing the rest of it.
 *
 * This is a narrow line reader, not a YAML parser. It understands a top-level
 * block mapping `mcp_servers:` whose children are block mappings of scalar
 * keys, with values written as plain or quoted scalars, flow sequences of
 * scalars, or block sequences of scalars. A file that writes the servers any
 * other way (an inline mapping, anchors, tabs, several documents) or a
 * server entry carrying a nested setting is refused with its bytes
 * untouched, so a form this module misreads can never be corrupted.
 * Everything outside the server's own block keeps its exact bytes, line
 * endings and comments included, and an unchanged entry leaves the file as
 * it was.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { MergeResult } from './merge-mcp.ts';

export type YamlValue = string | number | boolean | readonly string[];

const SERVERS_KEY = 'mcp_servers';

interface Line {
  readonly text: string;
  readonly eol: string;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  for (const m of text.matchAll(/([^\n]*?)(\r?\n|$)/g)) {
    if (m[0] === '' && m.index === text.length) break;
    lines.push({ text: m[1]!, eol: m[2]! });
  }
  return lines;
}

const indentOf = (text: string): number => /^ */.exec(text)![0].length;
const isContent = (text: string): boolean => !/^\s*(#.*)?$/.test(text);

const KEY_LINE = /^( *)([A-Za-z0-9_.-]+|"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'):(?:[ ]+(.*))?$/;

function parseKey(text: string): { readonly indent: number; readonly key: string; readonly rest: string } | null {
  const m = KEY_LINE.exec(text);
  if (!m) return null;
  const raw = m[2]!;
  let key: string;
  try {
    key = raw.startsWith('"') ? (JSON.parse(raw) as string) : raw.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw;
  } catch {
    // A YAML escape JSON does not share (\x20, \e): a form not read here.
    return null;
  }
  const rest = (m[3] ?? '').trim();
  return { indent: m[1]!.length, key, rest: rest.startsWith('#') ? '' : rest };
}

const PLAIN_ITEM = /^[^\s"'[\]{},#&*!|>%@`-][^,[\]{}#]*$|^-[^\s,[\]{}#][^,[\]{}#]*$/;

/** One scalar, or undefined when it is written in a form this module does not read. */
function parseScalar(raw: string): string | number | boolean | undefined {
  const quoted = /^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/.exec(raw);
  if (quoted) {
    try {
      return JSON.parse(quoted[1]!) as string;
    } catch {
      return undefined;
    }
  }
  const single = /^'((?:[^']|'')*)'\s*(?:#.*)?$/.exec(raw);
  if (single) return single[1]!.replace(/''/g, "'");
  const plain = raw.replace(/\s+#.*$/, '').trim();
  if (plain === '' || !PLAIN_ITEM.test(plain)) return undefined;
  if (/^(?:true|True|TRUE)$/.test(plain)) return true;
  if (/^(?:false|False|FALSE)$/.test(plain)) return false;
  if (/^-?\d+(?:\.\d+)?$/.test(plain)) return Number(plain);
  if (/^(?:null|Null|NULL|~)$/.test(plain)) return undefined;
  return plain;
}

/** A value on the key's own line, or undefined when it is written in a form this module does not read. */
function parseInline(raw: string): YamlValue | undefined {
  const flow = /^\[(.*)\]\s*(?:#.*)?$/.exec(raw);
  if (flow) {
    const inner = flow[1]!.trim();
    if (inner === '') return [];
    const items: string[] = [];
    for (const part of inner.match(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,]+/g) ?? []) {
      if (part.trim() === '') continue;
      const v = parseScalar(part.trim());
      if (typeof v !== 'string') return undefined;
      items.push(v);
    }
    // Every comma-separated piece must have been consumed; a stray quote or bracket means a form not read here.
    if (
      inner
        .replace(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,]+/g, '')
        .replace(/,/g, '')
        .trim() !== ''
    )
      return undefined;
    return items;
  }
  if (/^[{&*!|>]/.test(raw)) return undefined;
  return parseScalar(raw);
}

interface Child {
  readonly name: string;
  readonly line: number;
  readonly end: number;
}

type Located =
  | { readonly kind: 'none' }
  | { readonly kind: 'inline'; readonly line: number }
  | {
      readonly kind: 'block';
      readonly line: number;
      readonly end: number;
      readonly childIndent: number | null;
      readonly children: readonly Child[];
    }
  | { readonly kind: 'problem'; readonly problem: string };

function locate(lines: readonly Line[]): Located {
  if (lines[0]?.text.startsWith('\uFEFF')) return { kind: 'problem', problem: 'the file starts with a byte-order mark' };
  let documents = 0;
  for (const [i, l] of lines.entries()) {
    if (isContent(l.text) && l.text.includes('\t')) return { kind: 'problem', problem: 'the file uses tabs' };
    if (/^---(?:\s|$)/.test(l.text)) {
      documents += 1;
      if (documents > 1 || lines.slice(0, i).some((p) => isContent(p.text)))
        return { kind: 'problem', problem: 'the file holds more than one YAML document' };
    }
    if (/^\.\.\.(?:\s|$)/.test(l.text)) return { kind: 'problem', problem: 'the file holds more than one YAML document' };
  }
  const firstContent = lines.find((l) => isContent(l.text) && !/^---/.test(l.text));
  if (firstContent && indentOf(firstContent.text) > 0) return { kind: 'problem', problem: 'its top level is indented' };
  const topLevel = lines.flatMap((l, i) => (isContent(l.text) && indentOf(l.text) === 0 && !/^---/.test(l.text) ? [i] : []));
  // Every top-level line must be a plain `key:` this module reads; anything else (an explicit `?` key, a flow mapping) could be where the servers live.
  if (topLevel.some((i) => parseKey(lines[i]!.text) === null))
    return { kind: 'problem', problem: 'it has a top-level line this writer cannot read' };
  const servers = topLevel.filter((i) => parseKey(lines[i]!.text)?.key === SERVERS_KEY);
  if (servers.length > 1) return { kind: 'problem', problem: `${SERVERS_KEY} appears more than once` };
  if (servers.length === 0) return { kind: 'none' };
  const line = servers[0]!;
  const header = parseKey(lines[line]!.text)!;
  if (header.rest !== '') {
    return /^(?:\{\s*\}|null|~)\s*(?:#.*)?$/.test(header.rest)
      ? { kind: 'inline', line }
      : { kind: 'problem', problem: `${SERVERS_KEY} is written inline` };
  }
  const end = topLevel.find((i) => i > line) ?? lines.length;
  const content = lines.slice(line + 1, end).flatMap((l, k) => (isContent(l.text) ? [line + 1 + k] : []));
  if (content.length === 0) return { kind: 'block', line, end, childIndent: null, children: [] };
  const childIndent = indentOf(lines[content[0]!]!.text);
  const starts: { name: string; line: number }[] = [];
  for (const i of content) {
    const indent = indentOf(lines[i]!.text);
    if (indent < childIndent) return { kind: 'problem', problem: `${SERVERS_KEY} is indented inconsistently` };
    if (indent > childIndent) continue;
    const key = parseKey(lines[i]!.text);
    if (!key) return { kind: 'problem', problem: `${SERVERS_KEY} holds an entry this writer cannot read` };
    starts.push({ name: key.key, line: i });
  }
  const children = starts.map((s, k) => ({ name: s.name, line: s.line, end: starts[k + 1]?.line ?? end }));
  return { kind: 'block', line, end, childIndent, children };
}

interface ParsedServer {
  readonly values: Record<string, YamlValue>;
  /** Keys whose value this module does not read: a nested mapping, a null, or an unfamiliar form. */
  readonly unreadable: readonly string[];
  /** The step from the server's key to its settings, when it has any. */
  readonly step: number | null;
  /** The last line holding the server's content. */
  readonly last: number;
}

function parseServer(lines: readonly Line[], child: Child): ParsedServer {
  const head = parseKey(lines[child.line]!.text)!;
  const values: Record<string, YamlValue> = {};
  const unreadable: string[] = [];
  if (head.rest !== '') return { values, unreadable: [child.name], step: null, last: child.line };
  const content = lines.slice(child.line + 1, child.end).flatMap((l, k) => (isContent(l.text) ? [child.line + 1 + k] : []));
  const last = content.at(-1) ?? child.line;
  if (content.length === 0) return { values, unreadable, step: null, last };
  const bodyIndent = indentOf(lines[content[0]!]!.text);
  let k = 0;
  while (k < content.length) {
    const i = content[k]!;
    const text = lines[i]!.text;
    const key = indentOf(text) === bodyIndent ? parseKey(text) : null;
    if (!key) {
      unreadable.push(text.trim());
      k += 1;
      continue;
    }
    if (key.rest !== '') {
      const v = parseInline(key.rest);
      if (v === undefined) unreadable.push(key.key);
      else values[key.key] = v;
      k += 1;
      continue;
    }
    // A block value: the lines below that are deeper, or a sequence at the key's own indent.
    const body: string[] = [];
    k += 1;
    while (k < content.length) {
      const t = lines[content[k]!]!.text;
      const ind = indentOf(t);
      if (ind < bodyIndent || (ind === bodyIndent && !/^ *- /.test(t))) break;
      body.push(t);
      k += 1;
    }
    const itemIndent = body.length > 0 ? indentOf(body[0]!) : -1;
    const items = body
      .map((t) => (indentOf(t) === itemIndent ? /^ *- (.*)$/.exec(t)?.[1] : undefined))
      .map((raw) => (raw === undefined ? undefined : parseScalar(raw.trim())));
    if (body.length === 0 || items.some((v) => typeof v !== 'string')) unreadable.push(key.key);
    else values[key.key] = items as string[];
  }
  return { values, unreadable, step: bodyIndent - indentOf(lines[child.line]!.text), last };
}

const pad = (n: number): string => ' '.repeat(n);

function render(name: string, entry: Readonly<Record<string, YamlValue>>, indent: number, step: number, eol: string): Line[] {
  return [
    { text: `${pad(indent)}${name}:`, eol },
    ...Object.entries(entry).map(([k, v]) => ({ text: `${pad(indent + step)}${k}: ${JSON.stringify(v)}`, eol })),
  ];
}

function readLines(path: string): Line[] | { readonly problem: string } {
  try {
    return splitLines(readFileSync(path, 'utf8'));
  } catch {
    return { problem: 'the file cannot be read' };
  }
}

export interface YamlMergeOptions {
  /** A reason to leave an existing, different entry alone, or null to replace it. */
  readonly conflict?: (existing: Readonly<Record<string, YamlValue>>) => string | null;
}

export function mergeYamlServerBlock(
  path: string,
  name: string,
  entry: Readonly<Record<string, YamlValue>>,
  opts: YamlMergeOptions = {},
): MergeResult {
  const created = !existsSync(path);
  const read = created ? [] : readLines(path);
  if (!Array.isArray(read)) return { ok: false, reason: read.problem, path };
  const lines = read;
  const eol = lines.find((l) => l.eol !== '')?.eol ?? '\n';
  const located = locate(lines);
  if (located.kind === 'problem') return { ok: false, reason: located.problem, path };
  let next: Line[];
  if (located.kind === 'none' || located.kind === 'inline') {
    const block = [{ text: `${SERVERS_KEY}:`, eol }, ...render(name, entry, 2, 2, eol)];
    if (located.kind === 'inline') {
      next = [...lines.slice(0, located.line), ...block, ...lines.slice(located.line + 1)];
    } else {
      const head = lines.map((l, i) => (i === lines.length - 1 && l.eol === '' ? { text: l.text, eol } : l));
      next = [...head, ...block];
    }
  } else {
    const child = located.children.find((c) => c.name === name);
    const indent = located.childIndent ?? 2;
    if (child) {
      const parsed = parseServer(lines, child);
      if (parsed.unreadable.length > 0) {
        return {
          ok: false,
          reason: `its ${SERVERS_KEY}.${name} entry has settings this writer cannot read safely (${parsed.unreadable.join(', ')}); edit or remove that entry by hand`,
          path,
        };
      }
      if (isDeepStrictEqual(parsed.values, { ...entry })) return { ok: true, created: false, path, replaced: [] };
      const conflict = opts.conflict?.(parsed.values) ?? null;
      if (conflict) return { ok: false, reason: conflict, path };
      next = [...lines.slice(0, child.line), ...render(name, entry, indent, parsed.step ?? indent, eol), ...lines.slice(parsed.last + 1)];
    } else {
      const content = lines.slice(located.line, located.end).flatMap((l, k) => (isContent(l.text) ? [located.line + k] : []));
      const after = content.at(-1)!;
      const head = lines.slice(0, after + 1).map((l, i) => (i === after && l.eol === '' ? { text: l.text, eol } : l));
      next = [...head, ...render(name, entry, indent, indent, eol), ...lines.slice(after + 1)];
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next.map((l) => l.text + l.eol).join(''), 'utf8');
  if (created) {
    try {
      chmodSync(path, 0o600);
    } catch {
      // platforms without modes
    }
  }
  return { ok: true, created, path, replaced: [] };
}

/** The readable settings of one server entry, or null when the file or the entry is absent or not in a form read here. */
export function readYamlServerBlock(path: string, name: string): Record<string, YamlValue> | null {
  if (!existsSync(path)) return null;
  const lines = readLines(path);
  if (!Array.isArray(lines)) return null;
  const located = locate(lines);
  if (located.kind !== 'block') return null;
  const child = located.children.find((c) => c.name === name);
  if (!child) return null;
  const parsed = parseServer(lines, child);
  return parsed.unreadable.includes(name) ? null : parsed.values;
}
