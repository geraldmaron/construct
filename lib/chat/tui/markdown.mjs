/**
 * lib/chat/tui/markdown.mjs — terminal-safe markdown subset for construct chat.
 *
 * Renders headings, lists, inline/fenced code, horizontal rules, and simple
 * pipe tables into plain lines suitable for Ink Text or linear stdout. Unknown
 * constructs pass through unchanged; the renderer never throws on bad input.
 */

export function parseMarkdownLines(text, { width = 80 } = {}) {
  if (!text) return [];
  const lines = String(text).split('\n');
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
        out.push(...fenceBuf.map((l) => ({ type: 'code', text: l })));
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
      tableBuf.push(line);
      continue;
    }
    flushTable();

    if (/^---+\s*$/.test(line.trim())) {
      out.push({ type: 'rule' });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      out.push({ type: 'heading', level: heading[1].length, text: stripInline(heading[2]) });
      continue;
    }

    const bullet = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (bullet) {
      const indent = Math.floor(bullet[1].length / 2);
      out.push({ type: 'bullet', indent, text: stripInline(bullet[2]) });
      continue;
    }

    if (line.trim() === '') {
      out.push({ type: 'blank' });
      continue;
    }

    out.push({ type: 'paragraph', text: stripInline(line) });
  }

  flushTable();
  if (inFence && fenceBuf.length) out.push(...fenceBuf.map((l) => ({ type: 'code', text: l })));
  return out;
}

function isTableRow(line) {
  const t = line.trim();
  return t.includes('|') && !/^[\s|:-]+$/.test(t.replace(/\|/g, ''));
}

function renderTable(rows, width) {
  const parsed = rows
    .filter((r) => !/^\s*\|?[\s:-]+\|/.test(r))
    .map((r) => r.split('|').map((c) => stripInline(c.trim())).filter((c, i, a) => !(i === 0 && c === '') && !(i === a.length - 1 && c === '')));
  if (!parsed.length) return rows.map((r) => ({ type: 'paragraph', text: r }));

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
  return String(s)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.+?)\]\([^)]+\)/g, '$1');
}

export function markdownToPlain(text, { width = 80 } = {}) {
  return parseMarkdownLines(text, { width })
    .map((part) => {
      if (part.type === 'heading') return `${'#'.repeat(part.level)} ${part.text}`;
      if (part.type === 'bullet') return `${'  '.repeat(part.indent)}- ${part.text}`;
      if (part.type === 'code') return `  ${part.text}`;
      if (part.type === 'rule') return '---';
      if (part.type === 'blank') return '';
      return part.text || '';
    })
    .join('\n');
}
