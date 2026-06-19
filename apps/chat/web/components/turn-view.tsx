/**
 * apps/chat/web/components/turn-view.tsx — transparency-first turn transcript for web chat.
 *
 * Renders each turn as ordered phases (route, thinking, tools, sources, answer,
 * usage) inline in the conversation column — same model as the Ink TurnTranscript.
 */

'use client';

import type { ReactNode } from 'react';
import type { ChatTurn } from '../hooks/use-chat-stream';

type TurnViewProps = {
  turn: ChatTurn;
  turnIndex?: number;
  detailDense?: boolean;
};

function Phase({ title, children }: { title: string; children: ReactNode }) {
  if (children == null || children === false) return null;
  return (
    <div className="cx-chat-phase">
      <div className="cx-chat-section-title">{title}</div>
      <div className="cx-chat-phase-body">{children}</div>
    </div>
  );
}

export function TurnView({ turn, turnIndex }: TurnViewProps) {
  const routeRows: Array<{ label: string; value: string }> = [];
  if (turn.overlay?.intent) routeRows.push({ label: 'intent', value: turn.overlay.intent });
  if (turn.overlay?.workCategory) routeRows.push({ label: 'category', value: turn.overlay.workCategory });
  if (turn.overlay?.specialists?.length) {
    routeRows.push({ label: 'route', value: turn.overlay.specialists.join(' → ') });
  }

  return (
    <article className="cx-chat-turn">
      {turnIndex != null ? (
        <div className="cx-chat-section-title">{`TURN ${turnIndex}`}</div>
      ) : null}

      <Phase title="YOU">
        <p>{turn.userText}</p>
      </Phase>

      {routeRows.length > 0 ? (
        <Phase title="ROUTE">
          {routeRows.map((row) => (
            <p key={row.label} className="cx-chat-muted">
              <span>{row.label}: </span>
              {row.value}
            </p>
          ))}
        </Phase>
      ) : null}

      {turn.thinking ? (
        <Phase title="THINKING">
          <pre className="cx-chat-muted" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{turn.thinking}</pre>
        </Phase>
      ) : null}

      {turn.tools.length > 0 ? (
        <Phase title="TOOLS">
          {turn.tools.map((tool) => (
            <p key={tool.id} className="cx-chat-tool">
              {tool.status === 'completed' ? '✓' : tool.status === 'failed' ? '✗' : '·'}
              {' '}
              {tool.title}
              {tool.input?.path ? `  ${String(tool.input.path)}` : ''}
              {tool.input?.pattern ? `  ${String(tool.input.pattern)}` : ''}
              {tool.input?.glob ? `  ${String(tool.input.glob)}` : ''}
            </p>
          ))}
        </Phase>
      ) : null}

      {turn.sources.length > 0 ? (
        <Phase title="SOURCES">
          {turn.sources.map((ref) => (
            <p key={ref} className="cx-chat-muted">{ref}</p>
          ))}
        </Phase>
      ) : null}

      {(turn.assistant || turn.working) ? (
        <Phase title="CONSTRUCT">
          {turn.assistant ? (
            <div className="cx-chat-muted" style={{ whiteSpace: 'pre-wrap' }}>{turn.assistant}</div>
          ) : (
            <p className="cx-chat-muted">working…</p>
          )}
        </Phase>
      ) : null}

      {turn.usage ? (
        <Phase title="USAGE">
          <p className="cx-chat-muted">
            {JSON.stringify((turn.usage as { tokens?: Record<string, number> }).tokens || turn.usage)}
          </p>
        </Phase>
      ) : null}
    </article>
  );
}
