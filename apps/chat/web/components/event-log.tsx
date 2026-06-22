/**
 * apps/chat/web/components/event-log.tsx — conversational transcript.
 */

'use client';

import type { ChatTurn, SessionMeta } from '../types';
import { TurnBlock } from './turn-block';
import { EmptyState } from './empty-state';

type EventLogProps = {
  turns: ChatTurn[];
  layers: Record<string, boolean>;
  sessionMeta: SessionMeta;
  streaming: boolean;
  onOpenModelPicker: () => void;
  onOpenSettingsPicker: () => void;
  onSelectTurn: (turnId: string) => void;
  activeTurnId: string | null;
  onOpenInspector: (turnId: string) => void;
};

export function EventLog({
  turns,
  layers,
  sessionMeta,
  streaming,
  onOpenModelPicker: _onOpenModelPicker,
  onOpenSettingsPicker: _onOpenSettingsPicker,
  onSelectTurn,
  activeTurnId,
  onOpenInspector,
}: EventLogProps) {
  return (
    <section className="cx-conv-log" aria-label="Conversation" role="log" aria-live="polite">
      {turns.length === 0 ? (
        <EmptyState sessionMeta={sessionMeta} />
      ) : (
        <div className="cx-conv-transcript">
          {turns.map((turn) => (
            <TurnBlock
              key={turn.id}
              turn={turn}
              layers={layers}
              streaming={streaming}
              isActive={activeTurnId === turn.id}
              onSelect={() => onSelectTurn(turn.id)}
              onOpenInspector={() => onOpenInspector(turn.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
