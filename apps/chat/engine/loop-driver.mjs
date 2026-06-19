/**
 * apps/chat/engine/loop-driver.mjs — Construct's owned agent loop, exposed as a
 * driver implementing the normalized event union (lib/chat/harness/driver.mjs).
 *
 * ADR-0041 reverses the delegate-the-loop posture: Construct now runs the loop
 * (prompt -> model -> tool calls -> tool results -> repeat) on a provider-agnostic
 * engine (Vercel AI SDK), so every token, tool result, and routing choice is
 * first-party data. This module is the seam that keeps the rest of the surface
 * host-agnostic: it owns the lifecycle (start/prompt/cancel/stop), maps the
 * engine's fullStream parts onto the driver event union, and accumulates per-turn
 * usage from the host's own numbers (no fabricated splits).
 *
 * The engine itself is injected as `createAgent` so this mapping layer is tested
 * against a scripted mock with no network or API key — the same dependency-
 * injection discipline the retired host adapters used (fetchImpl / spawnFn). The
 * real engine lives in ai-sdk-agent.mjs and is lazy-imported only when chat runs.
 */

import { AsyncEventQueue } from '../../../lib/chat/harness/driver.mjs';
import { listChatModels, recommendChatModel } from './models.mjs';

// Vercel AI SDK fullStream parts use a few delta field names across versions;
// read text from any of them so the mapping survives a minor SDK bump.

function partText(part) {
  if (typeof part.text === 'string') return part.text;
  if (typeof part.textDelta === 'string') return part.textDelta;
  if (typeof part.delta === 'string') return part.delta;
  return '';
}

// Usage arrives on finish parts as inputTokens/outputTokens/etc.; normalize to
// the union's token shape, emitting only fields the engine actually reported.

function normalizeUsage(part) {
  const u = part.totalUsage || part.usage || null;
  if (!u) return null;
  const tokens = {};
  if (Number.isFinite(u.inputTokens)) tokens.input = u.inputTokens;
  if (Number.isFinite(u.outputTokens)) tokens.output = u.outputTokens;
  if (Number.isFinite(u.reasoningTokens)) tokens.reasoning = u.reasoningTokens;
  if (Number.isFinite(u.cachedInputTokens)) tokens.cacheRead = u.cachedInputTokens;
  if (Number.isFinite(u.totalTokens)) tokens.total = u.totalTokens;
  else if (Number.isFinite(tokens.input) || Number.isFinite(tokens.output)) {
    tokens.total = (tokens.input || 0) + (tokens.output || 0) + (tokens.reasoning || 0);
  }
  if (!Object.keys(tokens).length) return null;
  const event = { type: 'usage', tokens };
  if (part.providerMetadata?.cost && Number.isFinite(part.providerMetadata.cost.amount)) {
    event.cost = { amount: part.providerMetadata.cost.amount, currency: part.providerMetadata.cost.currency || 'USD' };
  }
  return event;
}

// One fullStream part -> zero or more normalized driver events on the turn queue.
// Tool ids are tracked so a tool_call is emitted once and tool_update carries the
// terminal state, matching the union the renderers already consume.

function mapPart(part, queue, state) {
  switch (part.type) {
    case 'text-delta':
    case 'text': {
      const t = partText(part);
      if (t) queue.push({ type: 'text', text: t, messageId: part.id || null });
      break;
    }
    case 'reasoning-delta':
    case 'reasoning': {
      const t = partText(part);
      if (t) queue.push({ type: 'thinking', text: t, messageId: part.id || null });
      break;
    }
    case 'tool-call': {
      const id = part.toolCallId || part.id;
      state.tools.add(id);
      queue.push({ type: 'tool_call', id, title: part.toolName || 'tool', kind: part.toolName || 'other', status: 'pending', input: part.input ?? part.args ?? null });
      break;
    }
    case 'tool-result': {
      const id = part.toolCallId || part.id;
      queue.push({ type: 'tool_update', id, status: 'completed', content: part.output ?? part.result ?? null });
      break;
    }
    case 'tool-error': {
      const id = part.toolCallId || part.id;
      queue.push({ type: 'tool_update', id, status: 'failed', content: part.error ? String(part.error.message || part.error) : null });
      break;
    }
    case 'finish-step':
    case 'finish': {
      const usage = normalizeUsage(part);
      if (usage) queue.push(usage);
      break;
    }
    case 'error':
      state.errored = true;
      queue.push({ type: 'error', message: part.error ? String(part.error.message || part.error) : 'engine error' });
      break;
    case 'abort':
      state.aborted = true;
      break;
    default:
      break;
  }
}

export function createOwnedLoopDriver({
  env = process.env,
  cwd = process.cwd(),
  model = null,
  handlers = {},
  systemPrompt = '',
  tools = null,
  createAgent,
} = {}) {
  if (typeof createAgent !== 'function') {
    throw new Error('createOwnedLoopDriver requires a `createAgent` factory (real engine or test mock)');
  }

  let agent = null;
  let activeTurn = null;
  let currentModel = model || null;

  async function start() {
    agent = await createAgent({ env, cwd, model: currentModel, handlers, systemPrompt, tools });
    if (agent?.model && !currentModel) currentModel = agent.model;
    return { sessionId: agent?.sessionId || `owned-${Date.now()}`, capabilities: { host: 'construct', ownedLoop: true } };
  }

  function prompt(text, opts = {}) {
    if (!agent) throw new Error('prompt() called before start()');
    const queue = new AsyncEventQueue();
    const controller = new AbortController();
    const turn = { queue, controller, tools: new Set(), aborted: false, errored: false };
    activeTurn = turn;
    if (opts.model) currentModel = opts.model;

    (async () => {
      try {
        const stream = await agent.streamTurn(text, {
          signal: controller.signal,
          model: currentModel,
          turnOverlay: opts.turnOverlay ?? null,
        });
        for await (const part of stream) {
          if (queue.closed) break;
          mapPart(part, queue, turn);
        }
        queue.push({ type: 'done', stopReason: turn.aborted ? 'cancelled' : turn.errored ? 'error' : 'end_turn' });
      } catch (err) {
        if (err?.name === 'AbortError' || turn.aborted) {
          queue.push({ type: 'done', stopReason: 'cancelled' });
        } else {
          queue.push({ type: 'error', message: err?.message || String(err) });
          queue.push({ type: 'done', stopReason: 'error' });
        }
      } finally {
        queue.close();
        if (activeTurn === turn) activeTurn = null;
      }
    })();

    return queue;
  }

  function cancel() {
    if (activeTurn) {
      activeTurn.aborted = true;
      try { activeTurn.controller.abort(); } catch { /* already aborted */ }
    }
  }

  function stop() {
    try { agent?.dispose?.(); } catch { /* nothing to dispose */ }
  }

  async function listModels() {
    if (agent?.listModels) {
      try { return await agent.listModels(); } catch { /* fall through to catalog */ }
    }
    return listChatModels({ env });
  }

  async function recommendModel() {
    if (currentModel) return null;
    return recommendChatModel({ env });
  }

  return {
    start,
    prompt,
    cancel,
    stop,
    listModels,
    recommendModel,
    get model() { return currentModel; },
    get sessionId() { return agent?.sessionId || null; },
  };
}
