/**
 * apps/chat/web/components/thinking-block.tsx — collapsible extended thinking section.
 *
 * Auto-expands while streaming; collapses to a summary line when the turn completes.
 */

'use client';

import { useEffect, useState } from 'react';
import { formatTokens } from '../lib/format';

type ThinkingBlockProps = {
  thinking: string;
  streaming: boolean;
  visible: boolean;
};

// Even with the policy now in the system role, a chatty model may narrate it
// back. Drop only lines that plainly restate the injected scaffolding, never
// genuine reasoning.
const POLICY_ECHO_RE = /(construct policy overlay|follow before answering|^\s*(intent|workcategory|work category|specialists|workingbranch|working branch|policy route)\s*:)/i;

function cleanThinking(text: string): string {
  if (!text) return text;
  return text
    .split('\n')
    .filter((line) => !POLICY_ECHO_RE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function ThinkingBlock({ thinking, streaming, visible }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (streaming && thinking) setExpanded(true);
    if (!streaming && thinking) setExpanded(false);
  }, [streaming, thinking]);

  if (!visible || !thinking) return null;

  const wordCount = thinking.split(/\s+/).filter(Boolean).length;
  const approxTokens = Math.round(wordCount * 1.3);
  const summary = `${formatTokens(approxTokens)} tokens`;

  return (
    <div className="cx-thinking-block" data-expanded={expanded}>
      <button
        type="button"
        className="cx-thinking-summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="cx-thinking-chevron" aria-hidden>›</span>
        <span className="cx-thinking-label">Thinking</span>
        <span className="cx-thinking-meta">{summary}</span>
        {streaming && expanded && (
          <span className="cx-thinking-live" aria-label="streaming">●</span>
        )}
      </button>
      {expanded && (
        <div className="cx-thinking-content" aria-label="Extended thinking">
          <pre className="cx-thinking-pre">{cleanThinking(thinking)}</pre>
        </div>
      )}
    </div>
  );
}
