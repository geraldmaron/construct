/**
 * apps/chat/web/components/event-log.tsx — mono event log stream for terminal cockpit.
 *
 * Each turn renders as prefixed log lines (YOU, ROUTE, THINK, TOOL, SRC, OUT,
 * USAGE). Full route detail lives in RouteDock; the log keeps continuity.
 */

'use client';

import type { ChatTurn } from '../types';
import { MarkdownMessage } from './markdown-message';

type EventLogProps = {
  turns: ChatTurn[];
  layers: Record<string, boolean>;
};

function toolGlyph(status: string) {
  if (status === 'completed') return '✓';
  if (status === 'failed') return '✗';
  if (status === 'in_progress') return '›';
  return '·';
}

function summarizeTools(tools: ChatTurn['tools']) {
  const groups = new Map<string, { count: number; status: string }>();
  for (const t of tools) {
    const title = t.title || 'tool';
    if (!groups.has(title)) groups.set(title, { count: 0, status: 'completed' });
    const g = groups.get(title)!;
    g.count += 1;
    if (t.status === 'failed') g.status = 'failed';
    else if (t.status === 'pending' && g.status !== 'failed') g.status = 'pending';
    else if (t.status === 'in_progress' && g.status === 'completed') g.status = 'in_progress';
  }
  return [...groups.entries()];
}

function formatUsage(usage: Record<string, unknown> | null) {
  if (!usage) return null;
  const tokens = (usage.tokens as Record<string, number>) || {};
  const parts: string[] = [];
  if (tokens.input) parts.push(`prompt ${tokens.input}`);
  if (tokens.output) parts.push(`output ${tokens.output}`);
  if (tokens.reasoning) parts.push(`reasoning ${tokens.reasoning}`);
  if (tokens.total) parts.push(`total ${tokens.total}`);
  const cost = usage.cost as { amount?: number } | undefined;
  if (cost?.amount) parts.push(`~$${cost.amount.toFixed(cost.amount < 1 ? 3 : 2)}`);
  return parts.length ? parts.join(' · ') : JSON.stringify(tokens);
}

function routeSummary(overlay: ChatTurn['overlay']) {
  if (!overlay) return null;
  const parts: string[] = [];
  if (overlay.intent) parts.push(`intent=${overlay.intent}`);
  if (overlay.track) parts.push(`track=${overlay.track}`);
  const n = overlay.specialists?.length || 0;
  parts.push(n ? `${n} specialists` : 'direct');
  return parts.join(' · ');
}

function TurnBlock({ turn, index, layers }: { turn: ChatTurn; index: number; layers: Record<string, boolean> }) {
  const isError = turn.assistant.startsWith('[error]');
  const toolGroups = summarizeTools(turn.tools);
  const srcLimit = 8;
  const srcHidden = Math.max(0, turn.sources.length - srcLimit);

  return (
    <li className="cx-cockpit-turn">
      <div className="cx-cockpit-log-line">
        <span className="cx-cockpit-tag">T{index}</span>
        <span className="cx-cockpit-channel">YOU</span>
        <span className="cx-cockpit-log-text">{turn.userText}</span>
      </div>

      {turn.overlay && layers.specialists !== false ? (
        <div className="cx-cockpit-log-line">
          <span className="cx-cockpit-tag">T{index}</span>
          <span className="cx-cockpit-channel cx-cockpit-channel-route">ROUTE</span>
          <span className="cx-cockpit-log-text cx-cockpit-muted">{routeSummary(turn.overlay)}</span>
        </div>
      ) : null}

      {turn.thinking && layers.thinking !== false ? (
        <div className="cx-cockpit-log-block">
          <div className="cx-cockpit-log-line">
            <span className="cx-cockpit-tag">T{index}</span>
            <span className="cx-cockpit-channel">THINK</span>
          </div>
          <pre className="cx-cockpit-pre cx-cockpit-muted">{turn.thinking}</pre>
        </div>
      ) : null}

      {toolGroups.length > 0 && layers.tools !== false ? (
        <div className="cx-cockpit-log-line">
          <span className="cx-cockpit-tag">T{index}</span>
          <span className="cx-cockpit-channel">TOOL</span>
          <span className="cx-cockpit-log-text">
            {toolGroups.map(([title, g]) => (
              <span key={title} className="cx-cockpit-tool">
                {`${toolGlyph(g.status)} ${title}${g.count > 1 ? ` ×${g.count}` : ''}`}
                {' '}
              </span>
            ))}
          </span>
        </div>
      ) : null}

      {turn.sources.length > 0 ? (
        <div className="cx-cockpit-log-block">
          <div className="cx-cockpit-log-line">
            <span className="cx-cockpit-tag">T{index}</span>
            <span className="cx-cockpit-channel">SRC</span>
          </div>
          {turn.sources.slice(0, srcLimit).map((ref) => (
            <p key={ref} className="cx-cockpit-src-line cx-cockpit-muted">{ref}</p>
          ))}
          {srcHidden > 0 ? (
            <p className="cx-cockpit-src-line cx-cockpit-muted">{`+${srcHidden} more`}</p>
          ) : null}
        </div>
      ) : null}

      {(turn.assistant || turn.working) ? (
        <div className="cx-cockpit-log-block">
          <div className="cx-cockpit-log-line">
            <span className="cx-cockpit-tag">T{index}</span>
            <span className="cx-cockpit-channel cx-cockpit-channel-out">OUT</span>
            {turn.working && !turn.assistant ? (
              <span className="cx-cockpit-log-text cx-cockpit-warn">working…</span>
            ) : null}
          </div>
          {turn.assistant ? (
            <MarkdownMessage text={turn.assistant} isError={isError} />
          ) : null}
        </div>
      ) : null}

      {turn.usage && layers.observability !== false ? (
        <div className="cx-cockpit-log-line">
          <span className="cx-cockpit-tag">T{index}</span>
          <span className="cx-cockpit-channel">USAGE</span>
          <span className="cx-cockpit-log-text cx-cockpit-muted">{formatUsage(turn.usage)}</span>
        </div>
      ) : null}
    </li>
  );
}

export function EventLog({ turns, layers }: EventLogProps) {
  return (
    <section className="cx-cockpit-log" aria-label="Event log" role="log" aria-live="polite">
      {turns.length === 0 ? (
        <p className="cx-cockpit-muted cx-cockpit-empty">
          construct › describe a change or ask a question. Route, tools, and usage stream inline; specialist chain stays pinned in the route dock.
        </p>
      ) : (
        <ol className="cx-cockpit-turn-list">
          {turns.map((turn, i) => (
            <TurnBlock key={turn.id} turn={turn} index={i + 1} layers={layers} />
          ))}
        </ol>
      )}
    </section>
  );
}
