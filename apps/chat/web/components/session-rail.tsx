/**
 * apps/chat/web/components/session-rail.tsx — persistent session metrics rail for web chat.
 *
 * Session-level telemetry only (model, layers, usage ledger, idle/working).
 * Per-turn route/thinking/tools stay in the main TurnView transcript column.
 */

'use client';

import type { ChatTurn } from '../hooks/use-chat-stream';

const LAYER_KEYS = ['thinking', 'path', 'specialists', 'tools', 'observability'] as const;

type SessionRailProps = {
  turns: ChatTurn[];
  streaming: boolean;
};

function sumTokens(turns: ChatTurn[]) {
  let input = 0;
  let output = 0;
  let total = 0;
  for (const turn of turns) {
    const tokens = (turn.usage as { tokens?: Record<string, number> } | null)?.tokens;
    if (!tokens) continue;
    input += tokens.input || 0;
    output += tokens.output || 0;
    total += tokens.total || 0;
  }
  return { input, output, total, turns: turns.filter((t) => t.usage).length };
}

export function SessionRail({ turns, streaming }: SessionRailProps) {
  const usage = sumTokens(turns);
  const layers = Object.fromEntries(LAYER_KEYS.map((k) => [k, true]));

  return (
    <aside className="cx-chat-inspector" aria-label="Session">
      <div className="cx-chat-section-title">session</div>

      <div className="cx-chat-section-title">layers</div>
      <p className="cx-chat-muted">
        {LAYER_KEYS.map((k) => `${k}=${layers[k] ? 'on' : 'off'}`).join(' · ')}
      </p>

      <div className="cx-chat-section-title">{`usage · ${usage.turns} turn${usage.turns === 1 ? '' : 's'}`}</div>
      {usage.total > 0 ? (
        <>
          <p className="cx-chat-muted">prompt: {usage.input}</p>
          <p className="cx-chat-muted">output: {usage.output}</p>
          <p className="cx-chat-muted">total: {usage.total}</p>
        </>
      ) : (
        <p className="cx-chat-muted">no tokens yet</p>
      )}

      <p className="cx-chat-muted" style={{ marginTop: 12 }}>
        {streaming ? 'working…' : 'idle'}
      </p>
    </aside>
  );
}
