/**
 * apps/chat/web/components/markdown-message.tsx — terminal-safe markdown subset.
 *
 * Headings, bullets, code blocks, and paragraphs for CONSTRUCT output in the
 * event log. Matches the Ink markdown subset without pulling Node-only parsers.
 */

'use client';

type Part =
  | { type: 'heading'; text: string }
  | { type: 'bullet'; text: string; indent: number }
  | { type: 'code'; text: string }
  | { type: 'rule' }
  | { type: 'blank' }
  | { type: 'paragraph'; text: string };

function parseMarkdown(text: string): Part[] {
  if (!text) return [];
  const lines = String(text).split('\n');
  const out: Part[] = [];
  let inFence = false;
  let fenceBuf: string[] = [];

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (inFence) {
        out.push({ type: 'code', text: fenceBuf.join('\n') });
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
    if (/^---+\s*$/.test(line.trim())) {
      out.push({ type: 'rule' });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      out.push({ type: 'heading', text: heading[2] });
      continue;
    }
    const bullet = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (bullet) {
      out.push({ type: 'bullet', indent: Math.floor(bullet[1].length / 2), text: bullet[2] });
      continue;
    }
    if (line.trim() === '') {
      out.push({ type: 'blank' });
      continue;
    }
    out.push({ type: 'paragraph', text: line });
  }
  if (inFence && fenceBuf.length) out.push({ type: 'code', text: fenceBuf.join('\n') });
  return out;
}

export function MarkdownMessage({ text, isError = false }: { text: string; isError?: boolean }) {
  const parts = parseMarkdown(text);
  return (
    <div className={isError ? 'cx-cockpit-md cx-cockpit-error' : 'cx-cockpit-md'}>
      {parts.map((part, i) => {
        if (part.type === 'heading') {
          return <p key={i} className="cx-cockpit-md-heading">{part.text}</p>;
        }
        if (part.type === 'bullet') {
          const pad = '  '.repeat(part.indent);
          return <p key={i} className="cx-cockpit-md-line">{`${pad}• ${part.text}`}</p>;
        }
        if (part.type === 'code') {
          return <pre key={i} className="cx-cockpit-md-code">{part.text}</pre>;
        }
        if (part.type === 'rule') {
          return <hr key={i} className="cx-cockpit-rule" />;
        }
        if (part.type === 'blank') return <div key={i} className="cx-cockpit-md-blank" />;
        return <p key={i} className="cx-cockpit-md-line">{part.text}</p>;
      })}
    </div>
  );
}
