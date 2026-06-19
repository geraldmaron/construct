/**
 * apps/chat/web/hooks/use-chat-stream.ts — EventSource client for owned-loop SSE.
 *
 * Reduces driver events into turn state for the web chat layout. Permission
 * decisions POST to /api/chat/loop/permission with CSRF double-submit.
 */

'use client';

import { useCallback, useRef, useState } from 'react';

export type ChatTool = {
  id: string;
  title: string;
  status: string;
  input?: Record<string, unknown> | null;
};

export type ChatTurn = {
  id: string;
  userText: string;
  assistant: string;
  thinking: string;
  tools: ChatTool[];
  overlay: {
    intent?: string | null;
    workCategory?: string | null;
    specialists?: string[];
  } | null;
  sources: string[];
  usage: Record<string, unknown> | null;
  working: boolean;
};

export type PendingPermission = {
  requestId: string;
  title: string;
  options: string[];
};

function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'cx_csrf') return rest.join('=');
  }
  return null;
}

function createTurn(userText: string): ChatTurn {
  return {
    id: `turn-${Date.now()}`,
    userText,
    assistant: '',
    thinking: '',
    tools: [],
    overlay: null,
    sources: [],
    usage: null,
    working: true,
  };
}

function applyEvent(turn: ChatTurn, event: Record<string, unknown>): ChatTurn {
  const next = { ...turn, tools: [...turn.tools], sources: [...turn.sources] };
  switch (event.type) {
    case 'overlay':
      next.overlay = {
        intent: (event.intent as string) || null,
        workCategory: (event.workCategory as string) || null,
        specialists: (event.specialists as string[]) || [],
      };
      break;
    case 'thinking':
      next.thinking += (event.text as string) || '';
      break;
    case 'text':
      next.assistant += (event.text as string) || '';
      break;
    case 'tool_call': {
      const id = String(event.id || '');
      next.tools.push({
        id,
        title: String(event.title || 'tool'),
        status: 'pending',
        input: (event.input as Record<string, unknown>) || null,
      });
      const ref = (event.input as Record<string, unknown>)?.path
        || (event.input as Record<string, unknown>)?.pattern
        || (event.input as Record<string, unknown>)?.glob;
      if (ref) next.sources.push(String(ref));
      break;
    }
    case 'tool_update': {
      const t = next.tools.find((x) => x.id === event.id);
      if (t) t.status = String(event.status || t.status);
      break;
    }
    case 'usage':
      next.usage = event as Record<string, unknown>;
      break;
    default:
      break;
  }
  return next;
}

export function useChatStream() {
  const [convId, setConvId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [pending, setPending] = useState<PendingPermission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const convRef = useRef<string | null>(null);

  const resolvePermission = useCallback(async (decision: string) => {
    if (!pending) return;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const csrf = getCsrfToken();
    if (csrf) headers['x-construct-csrf'] = csrf;
    await fetch('/api/chat/loop/permission', {
      method: 'POST',
      headers,
      body: JSON.stringify({ requestId: pending.requestId, decision }),
    });
    setPending(null);
  }, [pending]);

  const sendMessage = useCallback(async (message: string) => {
    const text = message.trim();
    if (!text || streaming) return;

    setError(null);
    setStreaming(true);
    const turn = createTurn(text);
    setTurns((prev) => [...prev, turn]);

    const params = new URLSearchParams({ message: text });
    if (convRef.current) params.set('id', convRef.current);
    const es = new EventSource(`/api/chat/loop/stream?${params.toString()}`);

    es.onmessage = (ev) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (event.type === 'session' && event.id) {
        convRef.current = String(event.id);
        setConvId(String(event.id));
        return;
      }

      if (event.type === 'permission') {
        setPending({
          requestId: String(event.requestId),
          title: String((event.toolCall as Record<string, unknown>)?.title || 'tool'),
          options: (event.options as string[]) || ['allow', 'reject'],
        });
        return;
      }

      if (event.type === 'done') {
        setTurns((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last) copy[copy.length - 1] = { ...last, working: false };
          return copy;
        });
        es.close();
        setStreaming(false);
        return;
      }

      if (event.type === 'error') {
        setError(String(event.message || 'stream error'));
        setTurns((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last) {
            copy[copy.length - 1] = {
              ...last,
              working: false,
              assistant: `[error] ${event.message}`,
            };
          }
          return copy;
        });
        es.close();
        setStreaming(false);
        return;
      }

      setTurns((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last) copy[copy.length - 1] = applyEvent(last, event);
        return copy;
      });
    };

    es.onerror = () => {
      es.close();
      setStreaming(false);
      setError((e) => e || 'connection lost');
    };
  }, [streaming]);

  return {
    convId,
    turns,
    pending,
    error,
    streaming,
    sendMessage,
    resolvePermission,
  };
}
