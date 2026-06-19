/**
 * lib/chat/openrouter-fallback.mjs — OpenRouter failure parsing and free-model fallback.
 *
 * When a free slug returns 404/429 at call time, walks the live poll for the next
 * candidate. Used by construct chat at session launch and on classified failures.
 */

import { classifyProviderFailure } from '../model-router.mjs';

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
  if (/rate[- ]?limit|429|temporarily rate-limited/i.test(raw)) {
    summary = raw.replace(/^Provider returned error\.?\s*/i, '').trim() || 'rate-limited upstream';
  } else if (/unavailable for free|paid version is available/i.test(raw)) {
    summary = 'free tier retired — use a different free model or paid slug';
  } else if (/Failed after \d+ attempts/i.test(text)) {
    summary = raw || 'provider error after retries';
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

export async function handleOpenRouterFailure({ session, error, env = process.env, currentModel }) {
  const parsed = parseOpenRouterError(error);
  const classified = classifyProviderFailure({ error: { message: parsed.text || parsed.raw } });
  if (!classified?.retryable) return null;
  if (!shouldAttemptFreeFallback(session, currentModel)) return null;

  recordFailedModel(session, currentModel);
  const exclude = getExcludeList(session);
  const { resolveFreeOpenRouterModel } = await import('../../apps/chat/engine/models.mjs');
  const next = await resolveFreeOpenRouterModel({ env, tier: 'standard', exclude });
  if (!next || next === currentModel) return null;

  const short = (id) => id.replace(/^openrouter\//, '');
  return {
    modelId: next,
    notice: `${short(currentModel)} failed (${parsed.summary}). Switched to ${short(next)}. Retry or /model to pick manually.`,
  };
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

    const fallback = await handleOpenRouterFailure({
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
