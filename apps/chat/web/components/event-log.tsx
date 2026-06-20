/**
 * apps/chat/web/components/event-log.tsx — conversational transcript.
 */

'use client';

import type { ChatTurn, SessionMeta } from '../types';
import { MarkdownMessage } from './markdown-message';
import { EmptyState } from './empty-state';

type EventLogProps = {
  turns: ChatTurn[];
  layers: Record<string, boolean>;
  sessionMeta: SessionMeta;
  onOpenModelPicker: () => void;
  onOpenSettingsPicker: () => void;
  onSelectTurn: (turnId: string) => void;
  activeTurnId: string | null;
};

function formatMetadata(turn: ChatTurn): string | null {
  const parts: string[] = [];
  if (turn.overlay?.specialists?.length) {
    parts.push(`via ${turn.overlay.specialists.join(', ')}`);
  }
  if (turn.tools?.length) {
    parts.push(`${turn.tools.length} tool${turn.tools.length === 1 ? '' : 's'}`);
  }
  const tokens = turn.usage?.tokens as Record<string, number> | undefined;
  if (tokens?.total) {
    parts.push(`${tokens.total}k tok`);
  }
  return parts.length ? `› ${parts.join(' · ')}` : null;
}

export function EventLog({
  turns,
  layers,
  sessionMeta,
  onOpenModelPicker,
  onOpenSettingsPicker,
  onSelectTurn,
  activeTurnId,
}: EventLogProps) {
  return (
    <section className="cx-conv-log" aria-label="Conversation" role="log" aria-live="polite">
      {turns.length === 0 ? (
        <EmptyState
          sessionMeta={sessionMeta}
          onOpenModelPicker={onOpenModelPicker}
          onOpenSettingsPicker={onOpenSettingsPicker}
        />
      ) : (
        <div className="cx-conv-transcript">
          {turns.map((turn) => {
            if (turn.system) {
              return (
                <div key={turn.id} className="cx-conv-system-notice">
                  <p>{turn.assistant}</p>
                </div>
              );
            }
            const metadata = formatMetadata(turn);
            const isActive = activeTurnId === turn.id;
            return (
              <div key={turn.id} className={`cx-conv-turn ${isActive ? 'cx-conv-turn-active' : ''}`}>
                <div className="cx-conv-you">
                  <p className="cx-conv-label">You</p>
                  <p className="cx-conv-text">{turn.userText}</p>
                </div>
                <div className="cx-conv-construct">
                  <p className="cx-conv-label">Construct</p>
                  {turn.working && !turn.assistant ? (
                    <p className="cx-conv-working">working…</p>
                  ) : turn.assistant ? (
                    <MarkdownMessage text={turn.assistant} isError={turn.assistant.startsWith('[error]')} />
                  ) : null}
                  {metadata ? (
                    <button
                      type="button"
                      className="cx-conv-metadata-summary"
                      onClick={() => onSelectTurn(turn.id)}
                      aria-label={`View details for this turn. ${metadata}`}
                    >
                      {metadata}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
