/**
 * apps/chat/web/components/user-bubble.tsx — user message block.
 */

'use client';

type UserBubbleProps = {
  text: string;
};

export function UserBubble({ text }: UserBubbleProps) {
  return (
    <div className="cx-user-bubble">
      <p className="cx-user-bubble-text">{text}</p>
    </div>
  );
}
