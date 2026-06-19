/**
 * apps/chat/web/hooks/use-chat-stream.ts — EventSource client for owned-loop SSE.
 *
 * Reduces driver events into turn state and session telemetry for the terminal
 * cockpit. Permission decisions POST to /api/chat/loop/permission with CSRF.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatTurn, LayerKey, PendingPermission, RouteOverlay, SessionMeta } from '../types';
import { LAYER_KEYS } from '../types';

function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'cx_csrf') return rest.join('=');
  }
  return null;
}

function parseOverlay(event: Record<string, unknown>): RouteOverlay {
  return {
    intent: (event.intent as string) || null,
    workCategory: (event.workCategory as string) || null,
    track: (event.track as string) || null,
    specialists: (event.specialists as string[]) || [],
    externalResearch: (event.externalResearch as RouteOverlay['externalResearch']) || null,
    riskFlags: (event.riskFlags as Record<string, boolean>) || null,
    contractChain: (event.contractChain as RouteOverlay['contractChain']) || [],
    framingChallenge: (event.framingChallenge as RouteOverlay['framingChallenge']) || null,
    dispatchSummary: (event.dispatchSummary as string) || null,
    dispatchReasons: (event.dispatchReasons as Record<string, string>) || null,
    triggers: (event.triggers as RouteOverlay['triggers']) || [],
    docAuthoring: (event.docAuthoring as RouteOverlay['docAuthoring']) || null,
    artifactReview: (event.artifactReview as RouteOverlay['artifactReview']) || null,
    sessionTurnIndex: (event.sessionTurnIndex as number) ?? 0,
    priorIntent: (event.priorIntent as string) || null,
    workingBranch: (event.workingBranch as string) || null,
  };
}

function parseSessionMeta(event: Record<string, unknown>): SessionMeta {
  return {
    model: (event.model as string) || null,
    modelMode: (event.modelMode as string) || 'pinned',
    sandbox: (event.sandbox as string) || null,
    permissionMode: (event.permissionMode as string) || null,
    layers: (event.layers as Record<string, boolean>) || undefined,
    workingBranch: (event.workingBranch as string) || null,
    ctx: (event.ctx as SessionMeta['ctx']) || null,
    oracle: (event.oracle as SessionMeta['oracle']) || null,
    usage: (event.usage as SessionMeta['usage']) || null,
  };
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
      next.overlay = parseOverlay(event);
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
  const [sessionMeta, setSessionMeta] = useState<SessionMeta>({});
  const [layers, setLayers] = useState<Record<string, boolean>>(
    Object.fromEntries(LAYER_KEYS.map((k) => [k, true])),
  );
  const [pending, setPending] = useState<PendingPermission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [routeDrawerOpen, setRouteDrawerOpen] = useState(false);
  const convRef = useRef<string | null>(null);

  useEffect(() => {
    fetch('/api/chat/config')
      .then((r) => r.json())
      .then((data) => {
        if (data.layers) setLayers(data.layers);
      })
      .catch(() => { /* config optional on first load */ });
  }, []);

  const toggleLayer = useCallback(async (key: LayerKey) => {
    const next = { ...layers, [key]: !layers[key] };
    setLayers(next);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const csrf = getCsrfToken();
    if (csrf) headers['x-construct-csrf'] = csrf;
    try {
      await fetch('/api/chat/config', {
        method: 'POST',
        headers,
        body: JSON.stringify({ layers: { [key]: next[key] } }),
      });
    } catch {
      setLayers(layers);
    }
  }, [layers]);

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

    if (text === '/clear') {
      setTurns([]);
      setError(null);
      return;
    }

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

      if (event.type === 'session_meta') {
        const meta = parseSessionMeta(event);
        setSessionMeta((prev) => ({ ...prev, ...meta }));
        if (meta.layers) setLayers(meta.layers);
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

  const activeOverlay = turns.length ? turns[turns.length - 1]?.overlay : null;

  return {
    convId,
    turns,
    sessionMeta,
    layers,
    activeOverlay,
    pending,
    error,
    streaming,
    routeDrawerOpen,
    setRouteDrawerOpen,
    sendMessage,
    resolvePermission,
    toggleLayer,
  };
}

export type { ChatTurn, ChatTool, RouteOverlay, SessionMeta, PendingPermission, LayerKey } from '../types';
export { LAYER_KEYS } from '../types';
