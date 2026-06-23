/**
 * lib/server/chat-loop.mjs — owned-loop SSE bridge for dashboard web chat.
 *
 * GET /api/chat/loop/stream streams the normalized driver event union as SSE.
 * POST /api/chat/loop/permission resolves ask-mode permission prompts.
 * POST /api/chat/loop/command runs slash commands without a model turn.
 * GET /api/chat/loop/history returns persisted turn snapshots for resume.
 * POST /api/chat/loop/cancel aborts an in-flight owned-loop stream.
 * GET /api/chat/models lists searchable model picker items.
 * Legacy /api/chat/* (claude --print) remains in chat.mjs for backward compat.
 */

import { randomBytes } from 'crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createWebChatRuntime, resolveWebPermission, listPendingPermissions, getWebChatRuntime, ensureDriverStarted,
} from '../chat/web-session.mjs';
import { planTurn, resolveLayers } from '../chat/transparency.mjs';
import { buildPlanContext } from '../chat/session-context.mjs';
import { applyOverlayToTurn, createTurnBlock } from '../chat/tui/turn-block.mjs';
import { overlayToSsePayload, sessionMetaToSsePayload } from '../chat/present.mjs';
import { loadChatConfig, saveChatConfig, LAYER_KEYS } from '../chat/config.mjs';
import { readOracleDockState } from '../intake/session-prelude.mjs';
import { handleWebChatCommand } from '../chat/web-commands.mjs';
import { runTurnWithFallback } from '../chat/openrouter-fallback.mjs';
import { runTurnInto } from '../chat/tui/turn-state.mjs';
import {
  chatSessionFilePath,
  createChatPersister,
  loadPersistedTurns,
} from '../chat/session-persist.mjs';
import {
  loadModelPickerItems, commitPickerModel, resolveModelPickerSelection, pickerSelectedId,
} from '../chat/model-picker.mjs';
import { getOrCreateConversation } from './chat.mjs';
import { deriveEvidenceVerdict } from '../chat/evidence.mjs';

const loopConversations = new Map();
const activeStreams = new Map();
const ROOT_PKG = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8'));

function loopConvMeta(conv, { cwd } = {}) {
  if (!loopConversations.has(conv.id)) {
    const persistPath = chatSessionFilePath({ cwd: cwd || process.cwd(), convId: conv.id });
    loopConversations.set(conv.id, {
      turnBlocks: [],
      turns: [],
      persistPath,
      persist: null,
    });
  }
  return loopConversations.get(conv.id);
}

function ensureLoopPersist(meta, { cwd, convId }) {
  if (meta.persist) return meta.persist;
  meta.persistPath = meta.persistPath || chatSessionFilePath({ cwd, convId });
  meta.persist = createChatPersister({
    cwd,
    sessionId: convId,
    resumePath: meta.persistPath,
    host: 'construct-web',
  });
  return meta.persist;
}

export function cancelChatLoopStream(convId) {
  const active = activeStreams.get(convId);
  if (!active) return false;
  active.cancelled = true;
  try { active.runtime?.driver?.cancel?.(); } catch { /* already stopped */ }
  return true;
}

function sseWrite(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function applyStreamEvent(turn, event) {
  switch (event.type) {
    case 'overlay':
      turn.overlay = {
        intent: event.intent || null,
        workCategory: event.workCategory || null,
        track: event.track || null,
        specialists: event.specialists || [],
        externalResearch: event.externalResearch || null,
        riskFlags: event.riskFlags || null,
        contractChain: event.contractChain || [],
        framingChallenge: event.framingChallenge || null,
        dispatchSummary: event.dispatchSummary || null,
        dispatchReasons: event.dispatchReasons || null,
        triggers: event.triggers || [],
        docAuthoring: event.docAuthoring || null,
        artifactReview: event.artifactReview || null,
        sessionTurnIndex: event.sessionTurnIndex ?? 0,
        priorIntent: event.priorIntent || null,
        workingBranch: event.workingBranch || null,
      };
      break;
    case 'thinking':
      turn.thinking += event.text || '';
      break;
    case 'text':
      turn.assistant += event.text || '';
      break;
    case 'tool_call': {
      const id = String(event.id || '');
      turn.tools.push({
        id,
        title: String(event.title || 'tool'),
        status: 'pending',
        input: event.input || null,
      });
      break;
    }
    case 'tool_update': {
      const t = turn.tools.find((x) => x.id === event.id);
      if (t) {
        t.status = String(event.status || t.status);
        t.content = event.content ?? t.content;
      }
      break;
    }
    case 'usage':
      turn.usage = event;
      break;
    case 'model_resolved':
      turn.resolvedModel = event.model || null;
      break;
    default:
      break;
  }
  return turn;
}

function snapshotToClientTurn(turn) {
  return {
    id: turn.id,
    userText: turn.userText,
    assistant: turn.assistant,
    thinking: turn.thinking,
    tools: turn.tools,
    overlay: turn.overlay,
    sources: turn.sources,
    usage: turn.usage,
    resolvedModel: turn.resolvedModel || null,
    evidence: turn.evidence || null,
    unverified: turn.evidence?.status === 'insufficient_evidence' || turn.evidence?.status === 'uncited_evidence' || turn.evidence?.status === 'partially_verified',
    working: false,
    system: false,
  };
}

export function handleChatLoopStream(req, res, { rootDir } = {}) {
  const url = new URL(req.url, 'http://localhost');
  const message = url.searchParams.get('message');
  const convId = url.searchParams.get('id') || undefined;
  const cwd = rootDir || process.cwd();

  if (!message) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'message query param required' }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const conv = getOrCreateConversation(convId);
  const meta = loopConvMeta(conv, { cwd });
  conv.messages.push({ role: 'user', content: message });
  sseWrite(res, { type: 'session', id: conv.id });

  const streamControl = { cancelled: false, runtime: null };
  activeStreams.set(conv.id, streamControl);

  (async () => {
    try {
      const runtime = await createWebChatRuntime({
        convId: conv.id,
        cwd,
        onPermission: (event) => sseWrite(res, { ...event, id: conv.id }),
      });
      streamControl.runtime = runtime;
      const persist = ensureLoopPersist(meta, { cwd, convId: conv.id });
      const planContext = buildPlanContext({
        session: runtime.session,
        cwd: runtime.cwd,
        turnBlocks: meta.turnBlocks,
        text: message,
      });
      const overlay = await planTurn(message, {
        env: runtime.env,
        context: planContext,
      }).catch(() => null);

      sseWrite(res, sessionMetaToSsePayload({
        session: runtime.session,
        layers: runtime.layers,
        workingBranch: overlay?.workingBranch || planContext.workingBranch,
        oracle: readOracleDockState({ cwd: runtime.cwd, env: runtime.env }),
      }));

      const liveTurn = {
        id: `turn-${Date.now()}`,
        userText: message,
        assistant: '',
        thinking: '',
        tools: [],
        overlay: null,
        sources: [],
        usage: null,
        resolvedModel: null,
        evidence: null,
        working: true,
      };

      if (overlay) {
        applyStreamEvent(liveTurn, overlayToSsePayload(overlay));
        sseWrite(res, overlayToSsePayload(overlay));
      }

      const emitEvent = (event) => {
        if (streamControl.cancelled) return;
        applyStreamEvent(liveTurn, event);
        if (event.type === 'usage') {
          const ctx = event.context?.used != null && event.context?.size != null
            ? { used: event.context.used, size: event.context.size }
            : null;
          sseWrite(res, sessionMetaToSsePayload({
            session: runtime.session,
            layers: runtime.layers,
            workingBranch: overlay?.workingBranch || planContext.workingBranch,
            oracle: readOracleDockState({ cwd: runtime.cwd, env: runtime.env }),
            ctx,
          }));
        }
        sseWrite(res, { ...event, id: conv.id });
        if (persist?.event) {
          try { persist.event(event); } catch { /* best-effort */ }
        }
      };

      await ensureDriverStarted(runtime);

      const { state, notice: fallbackNotice } = await runTurnWithFallback({
        driver: runtime.driver,
        text: message,
        session: runtime.session,
        layers: runtime.layers,
        env: runtime.env,
        promptOptions: {
          sandbox: runtime.session.sandbox,
          permissionMode: runtime.session.permissionMode,
          turnOverlay: overlay,
          model: runtime.session.model,
        },
        runTurnInto,
        onUpdate: (_state, event) => emitEvent(event),
      });

      if (fallbackNotice) {
        sseWrite(res, { type: 'text', text: `[notice] ${fallbackNotice}\n`, id: conv.id });
      }

      if (state?.error && !streamControl.cancelled) {
        sseWrite(res, { type: 'error', message: state.error, id: conv.id });
      }

      liveTurn.assistant = state?.assistant || liveTurn.assistant;
      liveTurn.working = false;
      liveTurn.evidence = deriveEvidenceVerdict({
        ...liveTurn,
        overlay,
        evidenceVisible: runtime.layers?.tools !== false,
      });
      liveTurn.sources = liveTurn.evidence.records.map((record) => record.target);
      if (!streamControl.cancelled) {
        sseWrite(res, { type: 'evidence', value: liveTurn.evidence, id: conv.id });
        sseWrite(res, {
          type: 'unverified',
          value: ['insufficient_evidence', 'uncited_evidence', 'partially_verified'].includes(liveTurn.evidence.status),
          id: conv.id,
        });
      }
      meta.turns.push(snapshotToClientTurn(liveTurn));

      const turn = createTurnBlock(message);
      if (overlay) applyOverlayToTurn(turn, overlay);
      turn.assistant = liveTurn.assistant;
      turn.thinking = liveTurn.thinking;
      turn.tools = liveTurn.tools;
      turn.sources = liveTurn.evidence.records.map((record) => ({ tool: record.tool, ref: record.target, ts: Date.now() }));
      turn.usage = liveTurn.usage;
      turn.evidence = liveTurn.evidence;
      meta.turnBlocks.push({ kind: 'turn', block: turn });
      if (persist?.transcriptBlock) {
        try { persist.transcriptBlock(turn); } catch { /* best-effort */ }
      }
      conv.messages.push({ role: 'assistant', content: liveTurn.assistant || '[no response]' });
      sseWrite(res, { type: 'done', stopReason: streamControl.cancelled ? 'cancelled' : 'end_turn', id: conv.id });
    } catch (err) {
      sseWrite(res, { type: 'error', message: err.message || String(err), id: conv.id });
    } finally {
      activeStreams.delete(conv.id);
      res.end();
    }
  })();

  req.on('close', () => {
    cancelChatLoopStream(conv.id);
  });
}

export function handleChatLoopCommand(req, res, { rootDir } = {}) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', async () => {
    try {
      const data = JSON.parse(body || '{}');
      const command = String(data.command || '').trim();
      if (!command.startsWith('/')) throw new Error('command must start with /');

      const cwd = rootDir || process.cwd();
      const conv = getOrCreateConversation(data.id);
      const meta = loopConvMeta(conv);

      let runtime = getWebChatRuntime(conv.id);
      if (!runtime) {
        runtime = await createWebChatRuntime({ convId: conv.id, cwd });
      }

      const result = await handleWebChatCommand(command, {
        runtime,
        cwd,
        turnBlocks: meta.turnBlocks,
        version: ROOT_PKG.version,
      });

      if (result.clear && conv) {
        meta.turnBlocks = [];
        meta.turns = [];
        conv.messages.length = 0;
      }

      const payload = {
        ok: result.ok !== false,
        output: result.output || null,
        clear: Boolean(result.clear),
        picker: result.picker || null,
      };

      if (runtime && (result.sessionMeta || result.layers)) {
        payload.sessionMeta = sessionMetaToSsePayload({
          session: runtime.session,
          layers: runtime.layers,
          oracle: readOracleDockState({ cwd, env: runtime.env }),
        });
      }

      if (conv) payload.id = conv.id;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

export function handleChatLoopHistory(req, res, { rootDir } = {}) {
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id');
  if (!id) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'id query param required' }));
    return;
  }

  const cwd = rootDir || process.cwd();
  let meta = loopConversations.get(id);
  if (!meta) {
    const persistPath = chatSessionFilePath({ cwd, convId: id });
    const loaded = loadPersistedTurns(persistPath);
    meta = { turns: loaded.turns, turnBlocks: loaded.turnBlocks, persistPath, persist: null };
    if (loaded.turns.length) loopConversations.set(id, meta);
  }
  const runtime = getWebChatRuntime(id);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    id,
    turns: meta?.turns || [],
    sessionMeta: runtime ? sessionMetaToSsePayload({
      session: runtime.session,
      layers: runtime.layers,
      oracle: readOracleDockState({ cwd: runtime.cwd, env: runtime.env }),
    }) : null,
  }));
}

export function handleChatLoopCancel(req, res) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    try {
      const data = JSON.parse(body || '{}');
      const id = data.id;
      if (!id) throw new Error('id required');
      const ok = cancelChatLoopStream(String(id));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

export async function handleChatModels(req, res, { rootDir, pollProviders } = {}) {
  const url = new URL(req.url, 'http://localhost');
  const convId = url.searchParams.get('id');
  const cwd = rootDir || process.cwd();
  const runtime = convId ? getWebChatRuntime(convId) : null;
  const { config } = loadChatConfig({ cwd });

  try {
    const items = await loadModelPickerItems(null, {
      env: runtime?.env || process.env,
      cwd,
      currentModel: runtime?.session?.model || config.model,
      modelMode: runtime?.session?.modelMode || config.modelMode,
      ...(pollProviders ? { pollProviders } : {}),
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      items,
      selectedId: runtime ? pickerSelectedId(runtime.session) : pickerSelectedId({ modelMode: config.modelMode, model: config.model, savedModel: config.model }),
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

export function handleChatModelSelect(req, res, { rootDir, pollProviders } = {}) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', async () => {
    try {
      const data = JSON.parse(body || '{}');
      const itemId = data.itemId;
      if (!itemId) throw new Error('itemId required');

      const cwd = rootDir || process.cwd();
      const conv = data.id ? getOrCreateConversation(data.id) : null;
      let runtime = conv ? getWebChatRuntime(conv.id) : null;
      if (conv && !runtime) runtime = await createWebChatRuntime({ convId: conv.id, cwd });

      const items = await loadModelPickerItems(null, {
        env: runtime?.env || process.env,
        cwd,
        currentModel: runtime?.session?.model,
        modelMode: runtime?.session?.modelMode,
        ...(pollProviders ? { pollProviders } : {}),
      });
      const item = items.find((i) => i.id === itemId);
      if (!item) throw new Error('model not found');
      if (item.disabled) throw new Error('model not available');

      const selection = await resolveModelPickerSelection(item, { env: runtime?.env || process.env });
      if (!selection?.modelId && selection?.mode !== 'free-router') throw new Error('could not resolve model');

      if (runtime) {
        commitPickerModel(runtime.session, selection, { cwd, layers: runtime.layers });
      } else {
        const stub = { permissionMode: 'allow_once', sandbox: 'workspace-write', layers: {} };
        commitPickerModel(stub, selection, { cwd });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        id: conv?.id || null,
        sessionMeta: runtime ? sessionMetaToSsePayload({
          session: runtime.session,
          layers: runtime.layers,
          oracle: readOracleDockState({ cwd, env: runtime?.env || process.env }),
        }) : null,
        model: selection.modelId,
        modelMode: selection.mode,
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

export function handleChatLoopPermission(req, res) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    try {
      const data = JSON.parse(body || '{}');
      if (!data.requestId || !data.decision) throw new Error('requestId and decision required');
      const ok = resolveWebPermission(data.requestId, data.decision);
      if (!ok) throw new Error('permission request not found or expired');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

export function handleChatLoopPending(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const convId = url.searchParams.get('id');
  if (!convId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'id query param required' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ pending: listPendingPermissions(convId) }));
}

export function handleChatLoopConfig(req, res, { rootDir } = {}) {
  const cwd = rootDir || process.cwd();

  if (req.method === 'GET') {
    const { config } = loadChatConfig({ cwd });
    const layers = resolveLayers({ env: process.env });
    for (const key of Object.keys(config.layers || {})) {
      if (config.layers[key] === false) layers[key] = false;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      layers,
      config: {
        layers: config.layers,
        model: config.model,
        modelMode: config.modelMode,
        permissionMode: config.permissionMode,
        sandbox: config.sandbox,
      },
    }));
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const { config, path: configPath } = loadChatConfig({ cwd });
        if (data.layers && typeof data.layers === 'object') {
          config.layers = { ...config.layers, ...data.layers };
          for (const key of LAYER_KEYS) {
            if (data.layers[key] === true || data.layers[key] === false) {
              config.layers[key] = data.layers[key];
            }
          }
        }
        if (data.modelMode) config.modelMode = data.modelMode;
        if (data.model !== undefined) config.model = data.model;
        if (data.permissionMode) config.permissionMode = data.permissionMode;
        if (data.sandbox) config.sandbox = data.sandbox;
        saveChatConfig(config, { cwd });

        const convId = data.id;
        const runtime = convId ? getWebChatRuntime(convId) : null;
        if (runtime) {
          if (data.layers) {
            for (const key of LAYER_KEYS) {
              if (data.layers[key] === true || data.layers[key] === false) {
                runtime.layers[key] = data.layers[key];
              }
            }
          }
          if (data.modelMode) runtime.session.modelMode = data.modelMode;
          if (data.model !== undefined) runtime.session.model = data.model;
          if (data.permissionMode) runtime.session.permissionMode = data.permissionMode;
          if (data.sandbox) runtime.session.sandbox = data.sandbox;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          layers: config.layers,
          path: configPath,
          sessionMeta: runtime ? sessionMetaToSsePayload({
            session: runtime.session,
            layers: runtime.layers,
            oracle: readOracleDockState({ cwd, env: runtime?.env || process.env }),
          }) : null,
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'method not allowed' }));
}

export function createLoopConversationId() {
  return randomBytes(12).toString('hex');
}
