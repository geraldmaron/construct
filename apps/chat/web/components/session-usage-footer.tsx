/**
 * apps/chat/web/components/session-usage-footer.tsx — session-level usage strip.
 *
 * Shown above the prompt when turns have been made. Displays accumulated token totals
 * and cost. Visible when layers.observability is on.
 */

'use client';

import { useState } from 'react';
import type { SessionMeta } from '../types';
import { formatTokens } from '../lib/format';

type SessionUsageFooterProps = {
  sessionMeta: SessionMeta;
  visible: boolean;
};

export function SessionUsageFooter({ sessionMeta, visible }: SessionUsageFooterProps) {
  const [expanded, setExpanded] = useState(false);

  if (!visible) return null;

  const usage = sessionMeta.usage;
  if (!usage?.turns || !usage.tokens?.total) return null;

  const t = usage.tokens;
  const cost = usage.cost;
  const turns = usage.turns;

  const parts: string[] = [
    `${formatTokens(t.total)} total`,
    `${turns} turn${turns === 1 ? '' : 's'}`,
  ];
  if (cost?.amount && cost.amount > 0) {
    const a = cost.amount;
    parts.push(`~$${a.toFixed(a < 0.01 ? 4 : a < 1 ? 3 : 2)}`);
  }

  const breakdown: Array<[string, number]> = [];
  if (t.input) breakdown.push(['in', t.input]);
  if (t.output) breakdown.push(['out', t.output]);
  if (t.cacheRead) breakdown.push(['cache↓', t.cacheRead]);
  if (t.cacheWrite) breakdown.push(['cache↑', t.cacheWrite]);
  if (t.reasoning) breakdown.push(['thinking', t.reasoning]);

  return (
    <div className="cx-session-strip">
      <div className="cx-session-strip-row">
        <span className="cx-session-strip-label">Session</span>
        <span className="cx-session-strip-summary">{parts.join(' · ')}</span>
        {breakdown.length > 0 && (
          <button
            type="button"
            className="cx-session-strip-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label="Toggle token breakdown"
          >
            {expanded ? '▴' : '▾'} breakdown
          </button>
        )}
      </div>
      {expanded && breakdown.length > 0 && (
        <div className="cx-session-breakdown">
          {breakdown.map(([k, v]) => (
            <span key={k} className="cx-session-breakdown-item">
              <span className="cx-session-breakdown-key">{k}</span>
              <span className="cx-session-breakdown-val">{formatTokens(v)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
