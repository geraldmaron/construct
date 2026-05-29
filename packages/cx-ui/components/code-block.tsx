/**
 * Editorial code block with header (language/title) + copy button. Bash
 * scripts get lightweight client-side highlighting matching the design's
 * cm-tok-* tokens; other languages render as-is. Mirrors the design's
 * `CodeBlock` + `highlightShell` (docs-components.jsx).
 */

'use client';

import { ReactNode, useState, Fragment, ReactElement, isValidElement } from 'react';

function highlightShell(src: string): ReactElement[] {
  const lines = src.split('\n');
  return lines.map((ln, i) => {
    if (ln.trim().startsWith('#')) {
      return (
        <div key={i}>
          <span className="cm-tok-com">{ln}</span>
        </div>
      );
    }
    const parts: ReactNode[] = [];
    const tokens = ln.split(/(\s+|"[^"]*"|'[^']*')/g).filter(Boolean);
    let sawCmd = false;
    tokens.forEach((t, j) => {
      if (/^\s+$/.test(t)) {
        parts.push(t);
      } else if (/^["'].*["']$/.test(t)) {
        parts.push(<span key={j} className="cm-tok-str">{t}</span>);
      } else if (t.startsWith('--') || (t.startsWith('-') && t.length > 1 && /^-[a-zA-Z]/.test(t))) {
        parts.push(<span key={j} className="cm-tok-flag">{t}</span>);
      } else if (!sawCmd) {
        parts.push(<span key={j} className="cm-tok-cmd">{t}</span>);
        sawCmd = true;
      } else {
        parts.push(t);
      }
    });
    return <div key={i}>{parts}</div>;
  });
}

function flattenChildren(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenChildren).join('');
  if (isValidElement(node)) {
    const elementProps = node.props as { children?: ReactNode };
    return flattenChildren(elementProps.children);
  }
  return '';
}

type CodeBlockProps = {
  lang?: string;
  title?: string;
  children: ReactNode;
};

export function CodeBlock({ lang = 'bash', title, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const code = flattenChildren(children).replace(/^\s+|\s+$/g, '');
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1100);
    } catch {
      /* clipboard write blocked by host */
    }
  };
  return (
    <div className="codeblock">
      <div className="cb-head">
        <span>{title || lang}</span>
        <button className="cb-copy" onClick={onCopy} type="button">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{lang === 'bash' ? <Fragment>{highlightShell(code)}</Fragment> : code}</pre>
    </div>
  );
}
