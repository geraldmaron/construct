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
          <pre className="cx-thinking-pre">{thinking}</pre>
        </div>
      )}
    </div>
  );
}
