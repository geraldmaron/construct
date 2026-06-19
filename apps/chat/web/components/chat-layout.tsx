/**
 * apps/chat/web/components/chat-layout.tsx — two-pane web chat shell.
 *
 * Full inline turn phases in the conversation column; SessionRail stays
 * persistent on the right for session-level metrics only.
 */

'use client';

import { useState } from 'react';
import { useChatStream } from '../hooks/use-chat-stream';
import { TurnView } from './turn-view';
import { SessionRail } from './session-rail';

export function ChatLayout() {
  const {
    turns, pending, error, streaming, sendMessage, resolvePermission,
  } = useChatStream();
  const [input, setInput] = useState('');

  const submit = () => {
    const text = input;
    setInput('');
    void sendMessage(text);
  };

  return (
    <div className="cx-chat">
      {error ? (
        <p role="alert" style={{ color: 'var(--cx-chat-danger)' }}>{error}</p>
      ) : null}

      <div className="cx-chat-panes">
        <section className="cx-chat-conversation" aria-label="Conversation">
          {turns.length === 0 ? (
            <p className="cx-chat-muted">
              Ask a question or describe a change. Route, thinking, tools, sources, and usage appear inline in each turn.
            </p>
          ) : (
            turns.map((turn, i) => (
              <TurnView key={turn.id} turn={turn} turnIndex={i + 1} />
            ))
          )}
        </section>
        <SessionRail turns={turns} streaming={streaming} />
      </div>

      {pending ? (
        <div className="cx-chat-permission" role="dialog" aria-label="Permission request">
          <strong>Permission:</strong>
          {' '}
          {pending.title}
          <div className="cx-chat-permission-actions">
            {pending.options.map((opt) => (
              <button key={opt} type="button" onClick={() => void resolvePermission(opt)}>
                {opt}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="cx-chat-composer">
        <input
          className="cx-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Message construct…"
          disabled={streaming}
          aria-label="Chat message"
        />
        <button
          type="button"
          className="cx-chat-send"
          onClick={submit}
          disabled={streaming || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
