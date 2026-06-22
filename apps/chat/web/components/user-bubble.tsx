/**
 * apps/chat/web/components/user-bubble.tsx — user message block.
 *
 * Mono YOU label with an optional real timestamp, then the message as plain
 * prose. The timestamp renders only when the turn carries a captured createdAt —
 * never a synthesized time.
 */

'use client';

type UserBubbleProps = {
  text: string;
  createdAt?: number;
};

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function UserBubble({ text, createdAt }: UserBubbleProps) {
  return (
    <div className="cx-user-bubble">
      <div className="cx-user-bubble-head">
        <span className="cx-user-bubble-label">YOU</span>
        {createdAt ? (
          <span className="cx-user-bubble-time">{formatClock(createdAt)}</span>
        ) : null}
      </div>
      <p className="cx-user-bubble-text">{text}</p>
    </div>
  );
}
