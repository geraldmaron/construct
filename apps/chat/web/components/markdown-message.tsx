/**
 * apps/chat/web/components/markdown-message.tsx — markdown renderer for CONSTRUCT output.
 *
 * Dependency-free subset covering what chat answers actually use: headings,
 * ordered + unordered lists (nested by indent), fenced code, horizontal rules,
 * and inline **bold** / *italic* / `code` / [links](url). Inline spans are
 * parsed so the answer never shows raw markdown punctuation.
 */

'use client';

import type { ReactNode } from 'react';

type Part =
  | { type: 'heading'; level: number; text: string }
  | { type: 'bullet'; indent: number; text: string }
  | { type: 'ordered'; indent: number; marker: string; text: string }
  | { type: 'code'; text: string }
  | { type: 'rule' }
  | { type: 'blank' }
  | { type: 'paragraph'; text: string };

const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+?\*\*)|(\*[^*\s][^*]*?\*)|(__[^_]+?__)|(\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i}`;
    if (tok.startsWith('`')) {
      nodes.push(<code key={key} className="cx-cockpit-md-icode">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('**')) {
      nodes.push(<strong key={key} className="cx-cockpit-md-strong">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('__')) {
      nodes.push(<strong key={key} className="cx-cockpit-md-strong">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('*')) {
      nodes.push(<em key={key}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith('[')) {
      const link = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (link) {
        nodes.push(
          <a key={key} className="cx-cockpit-md-link" href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>,
        );
      } else {
        nodes.push(tok);
      }
    }
    last = m.index + tok.length;
    i += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function parseMarkdown(text: string): Part[] {
  if (!text) return [];
  const lines = String(text).split('\n');
  const out: Part[] = [];
  let inFence = false;
  let fenceBuf: string[] = [];

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
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
    if (/^\s*---+\s*$/.test(line)) {
      out.push({ type: 'rule' });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      out.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      continue;
    }
    const ordered = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
    if (ordered) {
      out.push({ type: 'ordered', indent: Math.floor(ordered[1].length / 2), marker: ordered[2], text: ordered[3] });
      continue;
    }
    const bullet = line.match(/^(\s*)[-*•]\s+(.+)$/);
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
        const key = `md-${i}`;
        if (part.type === 'heading') {
          return (
            <p key={key} className={`cx-cockpit-md-heading cx-cockpit-md-h${part.level}`}>
              {renderInline(part.text, key)}
            </p>
          );
        }
        if (part.type === 'bullet') {
          return (
            <div key={key} className="cx-cockpit-md-li" style={{ marginLeft: `${part.indent * 18}px` }}>
              <span className="cx-cockpit-md-marker" aria-hidden>•</span>
              <span>{renderInline(part.text, key)}</span>
            </div>
          );
        }
        if (part.type === 'ordered') {
          return (
            <div key={key} className="cx-cockpit-md-li" style={{ marginLeft: `${part.indent * 18}px` }}>
              <span className="cx-cockpit-md-marker cx-cockpit-md-marker-num" aria-hidden>{part.marker}.</span>
              <span>{renderInline(part.text, key)}</span>
            </div>
          );
        }
        if (part.type === 'code') {
          return <pre key={key} className="cx-cockpit-md-code">{part.text}</pre>;
        }
        if (part.type === 'rule') {
          return <hr key={key} className="cx-cockpit-rule" />;
        }
        if (part.type === 'blank') return <div key={key} className="cx-cockpit-md-blank" />;
        return <p key={key} className="cx-cockpit-md-line">{renderInline(part.text, key)}</p>;
      })}
    </div>
  );
}
