/**
 * apps/chat/web/components/turn-block.tsx — composite turn renderer.
 *
 * Assembles UserBubble → RoutingBlock → ThinkingBlock → ToolCardList →
 * MarkdownMessage → TurnFooter in display order.
 */

'use client';

import type { ChatTurn } from '../types';
import { UserBubble } from './user-bubble';
import { RoutingBlock } from './routing-block';
import { ThinkingBlock } from './thinking-block';
import { ToolCardList } from './tool-card-list';
import { TurnFooter } from './turn-footer';
import { MarkdownMessage } from './markdown-message';

type TurnBlockProps = {
  turn: ChatTurn;
  layers: Record<string, boolean>;
  streaming: boolean;
  isActive: boolean;
  onSelect: () => void;
  onOpenInspector: () => void;
};

function layer(layers: Record<string, boolean>, key: string): boolean {
  return layers?.[key] !== false;
}

export function TurnBlock({
  turn,
  layers,
  streaming,
  isActive,
  onSelect,
  onOpenInspector,
}: TurnBlockProps) {
  if (turn.system) {
    return (
      <div className="cx-system-notice">
        <p>{turn.assistant}</p>
      </div>
    );
  }

  const isTurnStreaming = streaming && turn.working;

  return (
    <div
      className={`cx-turn-block${isActive ? ' cx-turn-block-active' : ''}${isTurnStreaming ? ' cx-turn-block-streaming' : ''}`}
      onClick={onSelect}
      role="group"
      aria-label="Conversation turn"
    >
      <UserBubble text={turn.userText} />

      <div className="cx-turn-response">
        <RoutingBlock
          overlay={turn.overlay}
          visible={layer(layers, 'specialists')}
        />

        <ThinkingBlock
          thinking={turn.thinking}
          streaming={isTurnStreaming}
          visible={layer(layers, 'thinking')}
        />

        <ToolCardList
          tools={turn.tools ?? []}
          visible={layer(layers, 'tools')}
        />

        {isTurnStreaming && !turn.assistant ? (
          <p className="cx-turn-working">working…</p>
        ) : turn.assistant ? (
          <MarkdownMessage
            text={turn.assistant}
            isError={turn.assistant.startsWith('[error]')}
          />
        ) : null}

        <TurnFooter
          turn={turn}
          visible={layer(layers, 'observability')}
          onOpenInspector={onOpenInspector}
        />
      </div>
    </div>
  );
}
