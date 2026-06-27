/**
 * lib/chat/tui/markdown.mjs — terminal-safe markdown subset for construct chat.
 *
 * Renders headings, lists, inline/fenced code, horizontal rules, and simple
 * pipe tables into plain lines suitable for Ink Text or linear stdout. Unknown
 * constructs pass through unchanged; the renderer never throws on bad input.
 * Inline markdown links and repo paths can render as OSC-8 terminal hyperlinks.
 */

import { fileUriForPath, formatPathLink, formatTitledLink, terminalLinksEnabled } from './terminal-links.mjs';
import path from 'node:path';

// Visible width ignores SGR color codes and the OSC-8 hyperlink envelope (the URL
// and the bracketing sequences are invisible; only the link label occupies cells).

const OSC8_ENVELOPE = /\x1b\]8;;[^\x07]*\x07/g;
const SGR = /\x1b\[[0-9;]*m/g;

export function ansiVisibleWidth(text) {
  return String(text).replace(OSC8_ENVELOPE, '').replace(SGR, '').length;
}

// Word-wrap a styled string to a visible-column width without corrupting markup:
// SGR codes and whole OSC-8 links are atomic and zero/label width, active color
// state is closed at each line end and reopened on the next so styling never
// bleeds, and a single word wider than the budget overflows rather than splitting.

export function wrapAnsi(styled, width) {
  const s = String(styled);
  if (width < 6 || ansiVisibleWidth(s) <= width) return [s];

  const words = [];
  let cur = null;
  const flush = () => { if (cur) { words.push(cur); cur = null; } };
  const ensure = () => { if (!cur) cur = { str: '', vw: 0, sgr: [] }; return cur; };

  let i = 0;
  while (i < s.length) {
    if (s.startsWith('\x1b]8;;', i)) {
      const mid = s.indexOf('\x07', i);
      const close = s.indexOf('\x1b]8;;\x07', mid + 1);
      if (mid !== -1 && close !== -1) {
        const full = s.slice(i, close + 6);
        ensure();
        cur.str += full;
        cur.vw += s.slice(mid + 1, close).length;
        i = close + 6;
        continue;
      }
    }
    const sgr = s.slice(i).match(/^\x1b\[[0-9;]*m/);
    if (sgr) { ensure(); cur.str += sgr[0]; cur.sgr.push(sgr[0]); i += sgr[0].length; continue; }
    const ch = s[i];
    if (ch === '\n') { flush(); words.push({ hardBreak: true }); i += 1; continue; }
    if (ch === ' ') { flush(); i += 1; continue; }
    ensure();
    cur.str += ch;
    cur.vw += 1;
    i += 1;
  }
  flush();

  const lines = [];
  let active = [];
  let line = '';
  let lineVw = 0;
  const apply = (codes) => { for (const c of codes) { if (/^\x1b\[0?m$/.test(c)) active = []; else active.push(c); } };
  const breakLine = () => { lines.push(line + (active.length ? '\x1b[0m' : '')); line = active.join(''); lineVw = 0; };

  for (const w of words) {
    if (w.hardBreak) { breakLine(); continue; }
    const sep = lineVw > 0 ? 1 : 0;
    if (lineVw > 0 && lineVw + sep + w.vw > width) breakLine();
    if (lineVw > 0) { line += ' '; lineVw += 1; }
    line += w.str;
    lineVw += w.vw;
    apply(w.sgr);
  }
  lines.push(line + (active.length ? '\x1b[0m' : ''));
  return lines;
}

function renderCodeFence(lines) {
  const body = lines.join('\n').trim();
  if (!body) return [];
  return lines.map((l) => ({ type: 'code', text: l }));
}

function stripHtml(text) {
  return String(text)
    .replace(/<br\s*\/?>/gi, ' · ')
    .replace(/<[^>]+>/g, '');
}

function normalizeMarkdownInput(text) {
  return stripHtml(String(text || ''));
}

export function parseMarkdownLines(text, { width = 80 } = {}) {
  if (!text) return [];
  const lines = normalizeMarkdownInput(text).split('\n');
  const out = [];
  let inFence = false;
  let fenceBuf = [];
  let tableBuf = [];

  const flushTable = () => {
    if (!tableBuf.length) return;
    out.push(...renderTable(tableBuf, width));
    tableBuf = [];
  };

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      flushTable();
      if (inFence) {
        out.push(...renderCodeFence(fenceBuf));
        fenceBuf = [];
        inFence = false;
      } else {
        inFence = true;
      }
      continue;
    }
    if (inFence) {
      fenceBuf.push(line);
      continue;
    }

    if (isTableRow(line)) {
      if (!isTableSeparator(line)) tableBuf.push(line);
      continue;
    }
    flushTable();

    if (/^---+\s*$/.test(line.trim())) {
      out.push({ type: 'rule' });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      out.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      continue;
    }

    const blockquote = line.match(/^>\s*(.*)$/);
    if (blockquote) {
      out.push({ type: 'blockquote', text: blockquote[1] });
      continue;
    }

    const bullet = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (bullet) {
      const indent = Math.floor(bullet[1].length / 2);
      out.push({ type: 'bullet', indent, text: bullet[2] });
      continue;
    }

    const ordered = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
    if (ordered) {
      const indent = Math.floor(ordered[1].length / 2);
      out.push({ type: 'ordered', indent, num: Number(ordered[2]), text: ordered[3] });
      continue;
    }

    if (line.trim() === '') {
      out.push({ type: 'blank' });
      continue;
    }

    out.push({ type: 'paragraph', text: line });
  }

  flushTable();
  if (inFence && fenceBuf.length) out.push(...renderCodeFence(fenceBuf));
  return out;
}

function isTableSeparator(line) {
  const cells = line.trim().split('|').map((c) => c.trim()).filter(Boolean);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableRow(line) {
  const t = line.trim();
  if (!t.includes('|')) return false;
  if (isTableSeparator(t)) return true;
  return /^\|?.+\|.+$/.test(t);
}

function renderTable(rows, width) {
  const parsed = rows
    .filter((r) => !isTableSeparator(r.trim()))
    .map((r) => r.split('|').map((c) => stripHtml(c.trim())).filter((c, i, a) => !(i === 0 && c === '') && !(i === a.length - 1 && c === '')));
  if (!parsed.length) return rows.map((r) => ({ type: 'paragraph', text: stripInline(r) }));

  if (parsed.every((row) => row.length === 2)) {
    return parsed.map((row) => ({ type: 'bullet', indent: 0, text: `${row[0]}: ${row[1]}` }));
  }

  const cols = Math.max(...parsed.map((r) => r.length));
  const colWidth = Math.max(8, Math.floor((width - cols - 1) / cols));
  const out = [{ type: 'paragraph', text: '' }];
  for (const row of parsed) {
    const cells = row.map((c) => truncate(c, colWidth));
    while (cells.length < cols) cells.push('');
    out.push({ type: 'paragraph', text: cells.join(' | ') });
  }
  return out;
}

function truncate(s, max) {
  if (s.length <= max) return s.padEnd(max);
  return `${s.slice(0, max - 1)}…`;
}

function stripInline(s) {
  return stripHtml(String(s))
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.+?)\]\([^)]+\)/g, '$1');
}

export function markdownToPlain(text, { width = 80 } = {}) {
  return parseMarkdownLines(text, { width })
    .map((part) => {
      if (part.type === 'heading') {
        const mark = part.level === 1 ? '━━' : part.level === 2 ? '──' : '··';
        return `${mark} ${part.text}`;
      }
      if (part.type === 'blockquote') return `  ${part.text}`;
      if (part.type === 'bullet') return `${'  '.repeat(part.indent)}• ${part.text}`;
      if (part.type === 'ordered') return `${'  '.repeat(part.indent)}${part.num}. ${part.text}`;
      if (part.type === 'code') return `  ${part.text}`;
      if (part.type === 'rule') return '─'.repeat(Math.min(width, 48));
      if (part.type === 'blank') return '';
      return part.text || '';
    })
    .join('\n');
}

const INLINE_PATH =
  /(`?)((?:\.cx\/|docs\/|inbox\/|skills\/|rules\/|lib\/|templates\/|specialists\/|tests\/|platforms\/|personas\/|schemas\/)?[\w][\w./-]*\.(?:md|mdx|json|mjs|ts|tsx|yml|yaml)|construct\.config\.json|package\.json|[A-Z][A-Z0-9_]*\.md)(`?)/;

function applyInlineAnsi(text, colors, { cwd = process.cwd(), linksEnabled = false } = {}) {
  if (!colors?.reset) return stripInline(text);
  let out = '';
  let i = 0;
  const s = String(text);
  while (i < s.length) {
    if (s.startsWith('**', i)) {
      const end = s.indexOf('**', i + 2);
      if (end !== -1) {
        out += `${colors.bold}${colors.emphasis}${s.slice(i + 2, end)}${colors.reset}`;
        i = end + 2;
        continue;
      }
    }
    if (s[i] === '*' && s[i + 1] !== '*') {
      const end = s.indexOf('*', i + 1);
      if (end !== -1) {
        out += `${colors.emphasis}${s.slice(i + 1, end)}${colors.reset}`;
        i = end + 1;
        continue;
      }
    }
    if (s[i] === '`') {
      const end = s.indexOf('`', i + 1);
      if (end !== -1) {
        const inner = s.slice(i + 1, end);
        if (linksEnabled && INLINE_PATH.test(inner)) {
          out += formatPathLink(inner, colors, { cwd, enabled: linksEnabled });
        } else {
          out += `${colors.code}${inner}${colors.reset}`;
        }
        i = end + 1;
        continue;
      }
    }
    const link = s.slice(i).match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (link) {
      const label = link[1];
      const dest = link[2];
      const isUrl = /^https?:\/\//i.test(dest) || dest.startsWith('file:');
      const href = isUrl ? dest : fileUriForPath(path.resolve(cwd, dest), { cwd });
      out += formatTitledLink(label, href, colors, { enabled: linksEnabled, display: dest });
      i += link[0].length;
      continue;
    }
    const pathMatch = s.slice(i).match(INLINE_PATH);
    if (pathMatch && pathMatch.index === 0 && (i === 0 || /[\s(,]/.test(s[i - 1]))) {
      out += formatPathLink(pathMatch[2], colors, { cwd, enabled: linksEnabled });
      i += pathMatch[0].length;
      continue;
    }
    out += s[i];
    i += 1;
  }
  return out;
}

export function markdownToAnsi(text, { width = 80, colors = null, cwd = process.cwd(), stream = process.stdout, plain = false, env = process.env } = {}) {
  if (!colors?.reset) return markdownToPlain(text, { width });
  const linksEnabled = terminalLinksEnabled(env, { plain, stream });
  const inlineOpts = { cwd, linksEnabled };
  const headingStyle = colors.heading || colors.highlight || '';
  const parts = parseMarkdownLines(text, { width });
  const lines = [];
  for (const part of parts) {
    if (part.type === 'heading') {
      const mark = part.level === 1 ? '━━' : part.level === 2 ? '──' : '··';
      const body = applyInlineAnsi(part.text, colors, inlineOpts);
      lines.push(`${headingStyle}${colors.bold}${mark} ${body}${colors.reset}`);
      continue;
    }
    if (part.type === 'blockquote') {
      const wrapped = wrapAnsi(applyInlineAnsi(part.text, colors, inlineOpts), Math.max(8, width - 4));
      lines.push(wrapped.map((l) => `${colors.dim}  │${colors.reset} ${l}`).join('\n'));
      continue;
    }
    if (part.type === 'bullet') {
      const indent = '  '.repeat(part.indent);
      const wrapped = wrapAnsi(applyInlineAnsi(part.text, colors, inlineOpts), Math.max(8, width - indent.length - 2));
      lines.push(wrapped.map((l, idx) => (idx === 0
        ? `${indent}${colors.highlight}•${colors.reset} ${l}`
        : `${indent}  ${l}`)).join('\n'));
      continue;
    }
    if (part.type === 'ordered') {
      const indent = '  '.repeat(part.indent);
      const marker = `${part.num}. `;
      const wrapped = wrapAnsi(applyInlineAnsi(part.text, colors, inlineOpts), Math.max(8, width - indent.length - marker.length));
      lines.push(wrapped.map((l, idx) => (idx === 0
        ? `${indent}${colors.highlight}${part.num}.${colors.reset} ${l}`
        : `${indent}${' '.repeat(marker.length)}${l}`)).join('\n'));
      continue;
    }
    if (part.type === 'code') {
      const codeStyle = colors.code;
      lines.push(`${colors.dim}  │${colors.reset} ${codeStyle}${part.text}${colors.reset}`);
      continue;
    }
    if (part.type === 'rule') {
      lines.push(`${colors.dim}${'─'.repeat(Math.min(width, 48))}${colors.reset}`);
      continue;
    }
    if (part.type === 'blank') {
      lines.push('');
      continue;
    }
    lines.push(wrapAnsi(applyInlineAnsi(part.text || '', colors, inlineOpts), width).join('\n'));
  }
  return lines.join('\n');
}

export function writeMarkdownAnsi(output, text, { width = 80, colors, prefix = '  ', cwd = process.cwd(), plain = false, env = process.env } = {}) {
  const body = markdownToAnsi(text, {
    width: width - prefix.length,
    colors,
    cwd,
    stream: output,
    plain,
    env,
  });
  if (!prefix) {
    output.write(`${body}\n`);
    return;
  }
  for (const line of body.split('\n')) {
    output.write(line ? `${prefix}${line}\n` : '\n');
  }
}
