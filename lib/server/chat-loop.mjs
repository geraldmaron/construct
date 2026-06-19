/**
 * lib/server/chat-loop.mjs — owned-loop SSE bridge for dashboard web chat.
 *
 * GET /api/chat/loop/stream streams the normalized driver event union as SSE.
 * POST /api/chat/loop/permission resolves ask-mode permission prompts.
 * Legacy /api/chat/* (claude --print) remains in chat.mjs for backward compat.
 */

import { randomBytes } from 'crypto';
import {
  createWebChatRuntime, resolveWebPermission, listPendingPermissions,
} from '../chat/web-session.mjs';
import { planTurn, resolveLayers } from '../chat/transparency.mjs';
import { buildPlanContext } from '../chat/session-context.mjs';
import { applyOverlayToTurn, createTurnBlock } from '../chat/tui/turn-block.mjs';
import { overlayToSsePayload, sessionMetaToSsePayload } from '../chat/present.mjs';
import { loadChatConfig, saveChatConfig, LAYER_KEYS } from '../chat/config.mjs';
import { readOracleDockState } from '../intake/session-prelude.mjs';
import { addUsage } from '../chat/tui/usage.mjs';
import { getOrCreateConversation } from './chat.mjs';

const loopConversations = new Map();

function loopConvMeta(conv) {
  if (!loopConversations.has(conv.id)) {
    loopConversations.set(conv.id, { turnBlocks: [] });
  }
  return loopConversations.get(conv.id);
}

function sseWrite(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function handleChatLoopStream(req, res, { rootDir } = {}) {
  const url = new URL(req.url, 'http://localhost');
  const message = url.searchParams.get('message');
  const convId = url.searchParams.get('id') || undefined;

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
  const meta = loopConvMeta(conv);
  conv.messages.push({ role: 'user', content: message });
  sseWrite(res, { type: 'session', id: conv.id });

  (async () => {
    try {
      const runtime = await createWebChatRuntime({
        convId: conv.id,
        cwd: rootDir || process.cwd(),
        onPermission: (event) => sseWrite(res, { ...event, id: conv.id }),
      });
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

      if (overlay) {
        sseWrite(res, overlayToSsePayload(overlay));
      }

      let assistant = '';
      for await (const event of runtime.driver.prompt(message, {
        sandbox: runtime.session.sandbox,
        permissionMode: runtime.session.permissionMode,
        turnOverlay: overlay,
      })) {
        if (event.type === 'usage') {
          addUsage(runtime.session, event);
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
        if (event.type === 'text') assistant += event.text || '';
      }

      const turn = createTurnBlock(message);
      if (overlay) applyOverlayToTurn(turn, overlay);
      turn.assistant = assistant;
      meta.turnBlocks.push({ kind: 'turn', block: turn });
      conv.messages.push({ role: 'assistant', content: assistant || '[no response]' });
      sseWrite(res, { type: 'done', stopReason: 'end_turn', id: conv.id });
    } catch (err) {
      sseWrite(res, { type: 'error', message: err.message || String(err), id: conv.id });
    } finally {
      res.end();
    }
  })();

  req.on('close', () => { /* driver cancel wired in a follow-up bead */ });
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
    res.end(JSON.stringify({ layers, config: { layers: config.layers } }));
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
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
        saveChatConfig(config, { cwd });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, layers: config.layers, path: configPath }));
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
