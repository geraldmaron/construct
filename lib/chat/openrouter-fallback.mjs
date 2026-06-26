/**
 * lib/chat/openrouter-fallback.mjs — OpenRouter failure parsing and turn-time fallback.
 *
 * When a free slug returns 404/429 at call time, walks the live poll for the next
 * candidate. When an Ollama tag is pinned but not pulled, falls through to the
 * next configured provider for the same turn (mirroring session launch resolution).
 */

import { classifyProviderFailure, resolveValidatedChatModel } from '../model-router.mjs';
import { formatModelFallbackNotice } from './user-error.mjs';
import { saveChatConfig } from './config.mjs';

const MAX_FALLBACK_ATTEMPTS = 3;

export function parseOpenRouterError(error) {
  const text = typeof error === 'string' ? error : String(error?.message || error || '');
  let raw = text;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const body = JSON.parse(jsonMatch[0]);
      raw = body?.error?.metadata?.raw || body?.error?.message || text;
    }
  } catch { /* not JSON */ }

  let summary = raw;
  const ollamaMissing = raw.match(/model ['"]([^'"]+)['"] not found/i);
  if (ollamaMissing) {
    const native = ollamaMissing[1];
    summary = `Ollama model '${native}' is not installed locally. Pull it with: ollama pull ${native} (or: construct ollama pull ${native})`;
  } else if (/rate[- ]?limit|429|temporarily rate-limited/i.test(raw)) {
    summary = raw.replace(/^Provider returned error\.?\s*/i, '').trim() || 'rate-limited upstream';
  } else if (/no endpoints found/i.test(raw)) {
    summary = raw.replace(/^Provider returned error\.?\s*/i, '').trim() || 'model slug unavailable on provider';
  } else if (/unavailable for free|paid version is available/i.test(raw)) {
    summary = 'free tier retired — use a different free model or paid slug';
  } else if (/Failed after \d+ attempts/i.test(text)) {
    summary = raw || 'provider error after retries';
  } else if (/OLLAMA_MODEL_NOT_PULLED|not installed locally/i.test(raw)) {
    summary = raw;
  }

  return { raw, summary, text };
}

export function ensureFailedModels(session) {
  if (!session.failedModels) session.failedModels = new Set();
  return session.failedModels;
}

export function recordFailedModel(session, modelId) {
  if (!modelId) return;
  ensureFailedModels(session).add(modelId);
}

export function getExcludeList(session) {
  return [...ensureFailedModels(session)];
}

export function shouldAttemptFreeFallback(session, modelId) {
  if (session?.modelMode === 'free-router') return true;
  return typeof modelId === 'string' && /:free$/i.test(modelId);
}

export function isOllamaNotPulledError(error) {
  const text = typeof error === 'string' ? error : String(error?.message || error || '');
  return error?.code === 'OLLAMA_MODEL_NOT_PULLED' || /not installed locally/i.test(text);
}

export async function handleOllamaNotPulledFailure({ session, error, env = process.env, currentModel }) {
  if (!isOllamaNotPulledError(error)) return null;
  if (typeof currentModel !== 'string' || !currentModel.startsWith('ollama/')) return null;

  recordFailedModel(session, currentModel);
  const excludeFamilies = typeof currentModel === 'string' && currentModel.startsWith('ollama/')
    ? ['ollama']
    : [];
  const next = resolveValidatedChatModel({ env, requested: null, excludeFamilies });
  if (!next?.id || next.id === currentModel) return null;

  return {
    modelId: next.id,
    notice: formatModelFallbackNotice({ fromModel: currentModel, toModel: next.id }),
  };
}

export async function handleModelFailure(opts) {
  const openRouter = await handleOpenRouterFailure(opts);
  if (openRouter) return openRouter;
  return handleOllamaNotPulledFailure(opts);
}

export async function handleOpenRouterFailure({ session, error, env = process.env, currentModel }) {
  const parsed = parseOpenRouterError(error);
  const classified = classifyProviderFailure({ error: { message: parsed.text || parsed.raw } });
  const isOpenRouter = typeof currentModel === 'string' && currentModel.startsWith('openrouter/');
  if (!isOpenRouter) return null;
  if (!classified?.retryable && !/no endpoints found/i.test(parsed.raw || parsed.text || '')) return null;

  recordFailedModel(session, currentModel);
  const exclude = getExcludeList(session);
  const { resolveFreeOpenRouterModel, resolveNextOpenRouterModel } = await import('../../apps/chat/engine/models.mjs');

  if (shouldAttemptFreeFallback(session, currentModel)) {
    const nextFree = await resolveFreeOpenRouterModel({ env, tier: 'standard', exclude });
    if (nextFree && nextFree !== currentModel) {
      return {
        modelId: nextFree,
        notice: formatModelFallbackNotice({ fromModel: currentModel, toModel: nextFree }),
        persistPin: session?.modelMode === 'pinned',
      };
    }
  }

  const next = resolveNextOpenRouterModel({ env, exclude, tier: 'standard' });
  if (!next || next === currentModel) return null;

  return {
    modelId: next,
    notice: formatModelFallbackNotice({ fromModel: currentModel, toModel: next }),
    persistPin: session?.modelMode === 'pinned',
  };
}

export function persistFallbackModel(session, modelId, { cwd = process.cwd() } = {}) {
  if (!session || !modelId || session.modelMode !== 'pinned') return;
  session.model = modelId;
  session.savedModel = modelId;
  try {
    saveChatConfig({
      host: session.host || null,
      model: modelId,
      modelMode: 'pinned',
      layers: session.layers,
      thinking: session.layers?.thinking,
      permissionMode: session.permissionMode,
      sandbox: session.sandbox,
      ui: session.ui,
    }, { cwd });
  } catch { /* persistence is best-effort */ }
}

export async function runTurnWithFallback({
  driver,
  text,
  session,
  layers,
  env,
  promptOptions = {},
  runTurnInto,
  onUpdate = () => {},
}) {
  let model = session.model;
  let lastState = null;
  let lastNotice = null;

  for (let attempt = 0; attempt < MAX_FALLBACK_ATTEMPTS; attempt++) {
    lastState = await runTurnInto(
      driver,
      text,
      { ...promptOptions, model, turnOverlay: promptOptions.turnOverlay },
      { session, layers, onUpdate },
    );

    if (!lastState.error) {
      return { state: lastState, model, notice: lastNotice };
    }

    const fallback = await handleModelFailure({
      session,
      error: lastState.error,
      env,
      currentModel: model,
    });
    if (!fallback) break;

    model = fallback.modelId;
    session.model = model;
    lastNotice = fallback.notice;
  }

  return { state: lastState, model, notice: lastNotice };
}

export { MAX_FALLBACK_ATTEMPTS };
