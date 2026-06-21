/**
 * apps/chat/web/components/turn-block.tsx — composite turn renderer.
 *
 * Lays out the user message, then the assistant header (CONSTRUCT label + usage
 * chip), a single metadata rail (route → thinking → tools → sources), and the
 * answer prose. The rail mirrors the Construct Chat design: one bordered panel
 * whose sections are divided by hairlines.
 */

'use client';

import type { ChatTurn } from '../types';
import { UserBubble } from './user-bubble';
import { RoutingBlock } from './routing-block';
import { ThinkingBlock } from './thinking-block';
import { ToolCardList } from './tool-card-list';
import { SourcesBlock } from './sources-block';
import { MarkdownMessage } from './markdown-message';
import { formatTokens } from '../lib/format';

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

function usageChip(turn: ChatTurn): string | null {
  const tokens = turn.usage?.tokens as Record<string, number> | undefined;
  if (!tokens) return null;
  const parts: string[] = [];
  if (tokens.total) parts.push(`${formatTokens(tokens.total)} tok`);
  if (tokens.input) parts.push(`${formatTokens(tokens.input)}↑`);
  if (tokens.output) parts.push(`${formatTokens(tokens.output)}↓`);
  return parts.length ? parts.join(' · ') : null;
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
  const showObservability = layer(layers, 'observability');
  const chip = !turn.working && showObservability ? usageChip(turn) : null;

  const showRoute = layer(layers, 'specialists') && !!turn.overlay;
  const showThinking = layer(layers, 'thinking') && (!!turn.thinking || isTurnStreaming);
  const showTools = layer(layers, 'tools') && !!turn.tools?.length;
  const showSources = showObservability && !!turn.sources?.length;
  const hasRail = showRoute || showThinking || showTools || showSources;

  const rail = hasRail ? (
    <div className="cx-metadata-rail">
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
      <SourcesBlock
        sources={turn.sources ?? []}
        visible={showObservability}
      />
    </div>
  ) : null;

  return (
    <div
      className={`cx-turn-block${isActive ? ' cx-turn-block-active' : ''}${isTurnStreaming ? ' cx-turn-block-streaming' : ''}`}
      onClick={onSelect}
      role="group"
      aria-label="Conversation turn"
    >
      <UserBubble text={turn.userText} createdAt={turn.createdAt} />

      <div className="cx-turn-response">
        <div className="cx-construct-head">
          <span className="cx-construct-ident">
            <span className="cx-construct-mark" aria-hidden />
            <span className="cx-construct-label">CONSTRUCT</span>
            {turn.resolvedModel && (
              <span className="cx-construct-via" title="Model that produced this answer">
                via {turn.resolvedModel}
              </span>
            )}
          </span>
          <span className="cx-construct-head-right">
            {turn.unverified && (
              <span
                className="cx-unverified-chip"
                title="This turn required reading the repo but the model answered without any read/grep — treat it as unverified."
              >
                unverified
              </span>
            )}
            {chip && <span className="cx-usage-chip">{chip}</span>}
            <button
              type="button"
              className="cx-turn-detail-btn"
              onClick={(e) => {
                e.stopPropagation();
                onOpenInspector();
              }}
              aria-label="View turn details in inspector"
              title="Open inspector for this turn"
            >
              ⋯
            </button>
          </span>
        </div>

        {rail}

        {isTurnStreaming && !turn.assistant ? (
          <p className="cx-turn-working">working…</p>
        ) : turn.assistant ? (
          <MarkdownMessage
            text={turn.assistant}
            isError={turn.assistant.startsWith('[error]')}
          />
        ) : null}
      </div>
    </div>
  );
}
