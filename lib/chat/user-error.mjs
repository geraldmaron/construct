/**
 * lib/chat/user-error.mjs — User-facing error lines for construct chat.
 *
 * Strips SDK stacks, request bodies, and provider metadata before anything
 * reaches the TUI. Provider-specific parsing lives in openrouter-fallback;
 * displayed messages always pass through formatUserFacingError.
 */

import { parseOpenRouterError } from './openrouter-fallback.mjs';

function firstLine(text) {
  return String(text || '').split('\n')[0].trim();
}

export function shortModelLabel(modelId) {
  if (!modelId || typeof modelId !== 'string') return 'model';
  return modelId.replace(/^openrouter\//, '');
}

export function formatUserFacingError(error) {
  const parsed = parseOpenRouterError(error);
  const raw = parsed.raw || parsed.summary || '';

  if (/no endpoints found/i.test(raw)) {
    return 'Model unavailable on provider';
  }
  if (/rate[- ]?limit|429|temporarily rate-limited/i.test(raw)) {
    return 'Rate limited — try again shortly';
  }
  if (/unauthorized|invalid.*api.*key|authentication|401|403/i.test(raw)) {
    return 'Authentication failed — check provider credentials';
  }
  if (/unavailable for free|paid version is available/i.test(raw)) {
    return 'Free tier unavailable for this model';
  }
  if (/OLLAMA_MODEL_NOT_PULLED|not installed locally/i.test(raw)) {
    return firstLine(parsed.summary) || 'Local model is not installed';
  }
  if (/model ['"][^'"]+['"] not found/i.test(raw)) {
    return firstLine(parsed.summary) || 'Local model is not installed';
  }
  if (/Failed after \d+ attempts/i.test(parsed.text || '')) {
    return 'Provider error after retries';
  }

  const line = firstLine(parsed.summary);
  if (!line || line.length > 160) return 'Model request failed';
  if (/APICallError|requestBodyValues|user_id/i.test(line)) return 'Model request failed';
  return line;
}

export function formatModelFallbackNotice({ fromModel, toModel }) {
  const from = shortModelLabel(fromModel);
  const to = shortModelLabel(toModel);
  return `Model ${from} is unavailable. Using ${to} for this session. Run /model to pin a default.`;
}
