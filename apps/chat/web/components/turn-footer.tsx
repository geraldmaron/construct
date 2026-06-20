/**
 * apps/chat/web/components/turn-footer.tsx — always-visible per-turn usage line.
 *
 * Shows input, output, cache read/write (first time these are surfaced in the UI),
 * reasoning tokens, cost, and source count. ⋯ opens the inspector turn tab.
 */

'use client';

import { formatUsageLine } from '../lib/format';
import type { ChatTurn } from '../types';

type TurnFooterProps = {
  turn: ChatTurn;
  visible: boolean;
  onOpenInspector: () => void;
};

export function TurnFooter({ turn, visible, onOpenInspector }: TurnFooterProps) {
  if (!visible) return null;
  if (turn.working) return null;

  const usage = turn.usage;
  const tokens = usage?.tokens as Record<string, number> | undefined;
  const cost = usage?.cost as { amount?: number } | undefined;
  const usageLine = formatUsageLine(tokens, cost);
  const sourceCount = turn.sources?.length ?? 0;

  if (!usageLine && !sourceCount) return null;

  return (
    <div className="cx-turn-footer">
      {usageLine && <span className="cx-turn-footer-usage">{usageLine}</span>}
      {sourceCount > 0 && (
        <span className="cx-turn-footer-sources">
          {sourceCount} source{sourceCount === 1 ? '' : 's'}
        </span>
      )}
      <button
        type="button"
        className="cx-turn-footer-detail"
        onClick={onOpenInspector}
        aria-label="View turn details in inspector"
        title="Open inspector for this turn"
      >
        ⋯
      </button>
    </div>
  );
}
