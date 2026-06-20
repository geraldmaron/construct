/**
 * apps/chat/web/components/tool-card-list.tsx — expandable tool call list.
 *
 * Collapsed: single line summary. Expanded: card per tool with status, primary input,
 * and optional full args on second expand.
 */

'use client';

import { useState } from 'react';
import type { ChatTool } from '../types';
import { toolStatusGlyph, toolStatusClass, summarizeToolCalls, primaryToolInput } from '../lib/format';

type ToolCardListProps = {
  tools: ChatTool[];
  visible: boolean;
};

function ToolCard({ tool }: { tool: ChatTool }) {
  const [argsOpen, setArgsOpen] = useState(false);
  const glyph = toolStatusGlyph(tool.status);
  const statusClass = toolStatusClass(tool.status);
  const primary = primaryToolInput(tool.input);
  const hasArgs = tool.input && Object.keys(tool.input).length > 0;

  return (
    <div className={`cx-tool-card cx-tool-card-${tool.status}`}>
      <div className="cx-tool-card-row">
        <span className={`cx-tool-glyph ${statusClass}`} aria-label={tool.status}>{glyph}</span>
        <span className="cx-tool-name">{tool.title}</span>
        {primary && <span className="cx-tool-input">{primary}</span>}
        {hasArgs && (
          <button
            type="button"
            className="cx-tool-args-toggle"
            onClick={() => setArgsOpen((v) => !v)}
            aria-expanded={argsOpen}
            aria-label="Toggle arguments"
          >
            {argsOpen ? '▴' : '▾'}
          </button>
        )}
      </div>
      {argsOpen && hasArgs && (
        <div className="cx-tool-args">
          {Object.entries(tool.input!).map(([k, v]) => (
            <div key={k} className="cx-tool-arg-row">
              <span className="cx-tool-arg-key">{k}</span>
              <span className="cx-tool-arg-val">
                {typeof v === 'string'
                  ? v.length > 120 ? v.slice(0, 120) + '…' : v
                  : JSON.stringify(v)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ToolCardList({ tools, visible }: ToolCardListProps) {
  const [expanded, setExpanded] = useState(false);

  if (!visible || !tools.length) return null;

  const summary = summarizeToolCalls(tools);
  const hasWorking = tools.some((t) => t.status === 'pending' || t.status === 'in_progress');

  return (
    <div className="cx-tool-card-list" data-expanded={expanded}>
      <button
        type="button"
        className="cx-tool-summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="cx-tool-summary-label">Tools</span>
        <span className="cx-tool-summary-count">{summary}</span>
        {hasWorking && <span className="cx-tool-working-dot" aria-label="tools running" />}
        <span className="cx-tool-chevron" aria-hidden>{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded && (
        <div className="cx-tool-cards">
          {tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}
