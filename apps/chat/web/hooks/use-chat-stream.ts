/**
 * apps/chat/web/hooks/use-chat-stream.ts — EventSource client for owned-loop SSE.
 *
 * Slash commands, session resume, model/set pickers, and layer toggles for the
 * terminal cockpit. Permission decisions POST to /api/chat/loop/permission with CSRF.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatTurn, LayerKey, PendingPermission, RouteOverlay, SessionMeta } from '../types';
import { LAYER_KEYS } from '../types';
import type { PickerItem } from '../components/list-picker';

function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'cx_csrf') return rest.join('=');
  }
  return null;
}

function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const csrf = getCsrfToken();
  if (csrf) headers['x-construct-csrf'] = csrf;
  return headers;
}

const SESSION_KEY = 'cx-chat-conv-id';

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

function createTurn(userText: string, system = false): ChatTurn {
  return {
    id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    userText: system ? '' : userText,
    assistant: system ? userText : '',
    thinking: '',
    tools: [],
    overlay: null,
    sources: [],
    usage: null,
    working: !system,
    system,
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
    case 'model_resolved':
      next.resolvedModel = (event.model as string) || null;
      break;
    case 'unverified':
      next.unverified = event.value !== false;
      break;
    default:
      break;
  }
  return next;
}

// Settings grouped by intent. Each carries a one-line description so the picker
// says what the setting does, not just its name. `thinking` lives only here as a
// transparency layer — it and the layer entry were the same toggle.
const SETTING_KEY_ITEMS: PickerItem[] = [
  { id: 'thinking', label: 'thinking', group: 'Transparency — what each turn shows', detail: 'show the model’s reasoning before the answer' },
  { id: 'path', label: 'path', group: 'Transparency — what each turn shows', detail: 'show the routing path for each turn' },
  { id: 'specialists', label: 'specialists', group: 'Transparency — what each turn shows', detail: 'show which specialists were engaged' },
  { id: 'tools', label: 'tools', group: 'Transparency — what each turn shows', detail: 'show tool calls — reads, writes, commands' },
  { id: 'observability', label: 'observability', group: 'Transparency — what each turn shows', detail: 'show token usage and telemetry' },
  { id: 'permission', label: 'permission', group: 'Safety — what Construct may do', detail: 'when tools run without asking you first' },
  { id: 'sandbox', label: 'sandbox', group: 'Safety — what Construct may do', detail: 'what files the tools are allowed to change' },
  { id: 'inspector', label: 'inspector panel', group: 'Appearance', detail: 'when the side telemetry panel is shown' },
  { id: 'theme', label: 'color theme', group: 'Appearance', detail: 'light, dark, or follow the system' },
  { id: 'model', label: 'model', group: 'Model', detail: 'choose the model that answers' },
];

const BOOL_ITEMS: PickerItem[] = [
  { id: 'on', label: 'on', detail: 'show this in every turn' },
  { id: 'off', label: 'off', detail: 'hide this' },
];

const PERMISSION_ITEMS: PickerItem[] = [
  { id: 'ask', label: 'ask', detail: 'prompt before every tool run (safest)' },
  { id: 'allow_once', label: 'allow once', detail: 'allow tools for this session only' },
  { id: 'allow_always', label: 'allow always', detail: 'never prompt — tools run freely' },
  { id: 'reject', label: 'reject', detail: 'block all tool runs' },
];

const SANDBOX_ITEMS: PickerItem[] = [
  { id: 'read-only', label: 'read-only', detail: 'tools can read but never write' },
  { id: 'workspace-write', label: 'workspace-write', detail: 'tools may write inside this project' },
  { id: 'danger-full-access', label: 'danger-full-access', detail: 'tools may write anywhere on disk' },
];

const INSPECTOR_ITEMS: PickerItem[] = [
  { id: 'off', label: 'off', detail: 'never show the inspector panel' },
  { id: 'auto', label: 'auto', detail: 'show it when a turn has detail' },
  { id: 'on', label: 'on', detail: 'always show the inspector panel' },
];

const THEME_ITEMS: PickerItem[] = [
  { id: 'auto', label: 'auto', detail: 'follow the system appearance' },
  { id: 'light', label: 'light', detail: 'light background' },
  { id: 'dark', label: 'dark', detail: 'dark background' },
];

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
  const [routeDrawerOpen, setRouteDrawerOpen] = useState(true);
  const [picker, setPicker] = useState<{ title: string; items: PickerItem[]; selectedId?: string | null; kind: string; context?: string } | null>(null);
  const convRef = useRef<string | null>(null);
  const resumedRef = useRef(false);
  const streamRef = useRef<EventSource | null>(null);

  const applyServerSessionMeta = useCallback((raw: Record<string, unknown> | null | undefined) => {
    if (!raw) return;
    const meta = parseSessionMeta(raw);
    setSessionMeta((prev) => ({ ...prev, ...meta }));
    if (meta.layers) setLayers(meta.layers);
  }, []);

  const persistConvId = useCallback((id: string) => {
    convRef.current = id;
    setConvId(id);
    try { sessionStorage.setItem(SESSION_KEY, id); } catch { /* private mode */ }
  }, []);

  useEffect(() => {
    fetch('/api/chat/config')
      .then((r) => r.json())
      .then((data) => {
        if (data.layers) setLayers(data.layers);
        if (data.config?.model) {
          setSessionMeta((prev) => ({
            ...prev,
            model: data.config.model,
            modelMode: data.config.modelMode,
            sandbox: data.config.sandbox,
            permissionMode: data.config.permissionMode,
          }));
        }
      })
      .catch(() => { /* config optional on first load */ });
  }, []);

  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('id');
    const stored = fromUrl || sessionStorage.getItem(SESSION_KEY);
    if (!stored) return;

    fetch(`/api/chat/loop/history?id=${encodeURIComponent(stored)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.id) return;
        persistConvId(data.id);
        if (Array.isArray(data.turns) && data.turns.length) {
          setTurns(data.turns);
        }
        applyServerSessionMeta(data.sessionMeta);
      })
      .catch(() => { /* fresh session */ });
  }, [applyServerSessionMeta, persistConvId]);

  const appendSystemOutput = useCallback((output: string) => {
    setTurns((prev) => [...prev, createTurn(output, true)]);
  }, []);

  const openSettingsPicker = useCallback(() => {
    setPicker({ kind: 'set-key', title: 'select setting', items: SETTING_KEY_ITEMS });
  }, []);

  const openModelPicker = useCallback(async () => {
    try {
      const modelsRes = await fetch(`/api/chat/models${convRef.current ? `?id=${encodeURIComponent(convRef.current)}` : ''}`);
      const modelsData = await modelsRes.json();
      if (!modelsRes.ok) {
        appendSystemOutput(modelsData.error || `model list failed (${modelsRes.status})`);
        return;
      }
      const items = modelsData.items || [];
      if (!items.length) {
        appendSystemOutput('no models available — configure a provider key in ~/.construct/config.env');
        return;
      }
      setPicker({
        kind: 'model',
        title: 'select model',
        items,
        selectedId: modelsData.selectedId,
      });
    } catch (err) {
      appendSystemOutput(err instanceof Error ? err.message : 'model picker failed');
    }
  }, [appendSystemOutput]);

  const runCommand = useCallback(async (command: string) => {
    const res = await fetch('/api/chat/loop/command', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ command, id: convRef.current }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'command failed');

    if (data.id) persistConvId(data.id);
    if (data.clear) {
      setTurns([]);
      setError(null);
    }
    if (data.output) appendSystemOutput(data.output);
    applyServerSessionMeta(data.sessionMeta);

    if (data.picker === 'model') {
      await openModelPicker();
    } else if (data.picker === 'set') {
      setPicker({
        kind: 'set-key',
        title: 'select setting',
        items: SETTING_KEY_ITEMS,
      });
    }
    return data;
  }, [appendSystemOutput, applyServerSessionMeta, openModelPicker, persistConvId]);

  const selectModel = useCallback(async (item: PickerItem) => {
    setPicker(null);
    const res = await fetch('/api/chat/models/select', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ itemId: item.id, id: convRef.current }),
    });
    const data = await res.json();
    if (!res.ok) {
      appendSystemOutput(data.error || 'model select failed');
      return;
    }
    if (data.id) persistConvId(data.id);
    applyServerSessionMeta(data.sessionMeta);
    // The select endpoint returns sessionMeta only once a runtime exists (after the
    // first turn). Always reflect the chosen model so the header chip updates even
    // when the pick happens from the empty state.
    setSessionMeta((prev) => ({ ...prev, model: data.model, modelMode: data.modelMode }));
    appendSystemOutput(`model set: ${data.modelMode === 'free-router' ? `free-router → ${data.model}` : data.model} (saved)`);
  }, [appendSystemOutput, applyServerSessionMeta, persistConvId]);

  const selectSettingKey = useCallback((item: PickerItem) => {
    if (item.id === 'model') {
      setPicker(null);
      void openModelPicker();
      return;
    }
    if ((LAYER_KEYS as readonly string[]).includes(item.id)) {
      setPicker({
        kind: 'set-value',
        title: `${item.label} — on or off`,
        items: BOOL_ITEMS,
        context: item.id,
      });
      return;
    }
    if (item.id === 'permission') {
      setPicker({ kind: 'set-value', title: 'permission mode', items: PERMISSION_ITEMS, context: 'permission' });
      return;
    }
    if (item.id === 'sandbox') {
      setPicker({ kind: 'set-value', title: 'sandbox', items: SANDBOX_ITEMS, context: 'sandbox' });
      return;
    }
    if (item.id === 'inspector') {
      setPicker({ kind: 'set-value', title: 'inspector panel', items: INSPECTOR_ITEMS, context: 'inspector' });
      return;
    }
    if (item.id === 'theme') {
      setPicker({ kind: 'set-value', title: 'color theme', items: THEME_ITEMS, context: 'theme' });
    }
  }, [openModelPicker]);

  const selectSettingValue = useCallback(async (item: PickerItem, key: string) => {
    setPicker(null);
    await runCommand(`/set ${key} ${item.id}`);
  }, [runCommand]);

  const handlePickerSelect = useCallback((item: PickerItem) => {
    if (!picker) return;
    if (picker.kind === 'model') {
      void selectModel(item);
      return;
    }
    if (picker.kind === 'set-key') {
      selectSettingKey(item);
      return;
    }
    if (picker.kind === 'set-value' && picker.context) {
      void selectSettingValue(item, picker.context);
    }
  }, [picker, selectModel, selectSettingKey, selectSettingValue]);

  const toggleLayer = useCallback(async (key: LayerKey) => {
    const next = { ...layers, [key]: !layers[key] };
    setLayers(next);
    try {
      const res = await fetch('/api/chat/config', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ layers: { [key]: next[key] }, id: convRef.current }),
      });
      const data = await res.json();
      applyServerSessionMeta(data.sessionMeta);
    } catch {
      setLayers(layers);
    }
  }, [applyServerSessionMeta, layers]);

  const resolvePermission = useCallback(async (decision: string) => {
    if (!pending) return;
    await fetch('/api/chat/loop/permission', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ requestId: pending.requestId, decision }),
    });
    setPending(null);
  }, [pending]);

  const cancelStream = useCallback(async () => {
    streamRef.current?.close();
    streamRef.current = null;
    if (convRef.current) {
      try {
        await fetch('/api/chat/loop/cancel', {
          method: 'POST',
          headers: apiHeaders(),
          body: JSON.stringify({ id: convRef.current }),
        });
      } catch { /* best-effort */ }
    }
    setStreaming(false);
    setTurns((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last?.working) copy[copy.length - 1] = { ...last, working: false };
      return copy;
    });
  }, []);

  const sendMessage = useCallback(async (message: string) => {
    const text = message.trim();
    if (!text || streaming) return;

    if (text.startsWith('/')) {
      if (text === '/model' || text === '/models') {
        await openModelPicker();
        return;
      }
      if (text === '/set') {
        setPicker({ kind: 'set-key', title: 'select setting', items: SETTING_KEY_ITEMS });
        return;
      }
      try {
        await runCommand(text);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'command failed');
      }
      return;
    }

    setError(null);
    setStreaming(true);
    const turn = createTurn(text);
    setTurns((prev) => [...prev, turn]);

    const params = new URLSearchParams({ message: text });
    if (convRef.current) params.set('id', convRef.current);
    const es = new EventSource(`/api/chat/loop/stream?${params.toString()}`);
    streamRef.current = es;

    es.onmessage = (ev) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (event.type === 'session' && event.id) {
        persistConvId(String(event.id));
        return;
      }

      if (event.type === 'session_meta') {
        applyServerSessionMeta(event);
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
        streamRef.current = null;
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
        streamRef.current = null;
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
      streamRef.current = null;
      setStreaming(false);
      setError((e) => e || 'connection lost');
    };
  }, [applyServerSessionMeta, openModelPicker, persistConvId, runCommand, streaming]);

  useEffect(() => () => {
    streamRef.current?.close();
  }, []);

  const activeOverlay = turns.filter((t) => !t.system).length
    ? turns.filter((t) => !t.system)[turns.filter((t) => !t.system).length - 1]?.overlay
    : null;

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
    picker,
    setPicker,
    sendMessage,
    resolvePermission,
    toggleLayer,
    handlePickerSelect,
    cancelStream,
    openModelPicker,
    openSettingsPicker,
  };
}

export type { ChatTurn, ChatTool, RouteOverlay, SessionMeta, PendingPermission, LayerKey } from '../types';
export { LAYER_KEYS } from '../types';
