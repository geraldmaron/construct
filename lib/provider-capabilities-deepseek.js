/**
 * lib/provider-capabilities-deepseek.js — DeepSeek provider capabilities.
 *
 * DeepSeek does not support prompt caching via standard APIs.
 * Uses ~3 chars per token (similar to Claude).
 * Max context: 64k for DeepSeek-V3, 32k for older models.
 */
import { resolveProviderCapabilities as _fallback } from './provider-capabilities.js';

export function deepseekCapabilities(modelId = '') {
  const contextWindow = resolveDeepSeekContextWindow(modelId);

  return {
    cacheControl: false,
    cacheMechanism: 'none',
    cacheTTL: null,
    structuredOutput: false,
    maxContextWindow: contextWindow,
    tokenRatio: 3, // ~3 chars per token for DeepSeek
    annotationFormat: 'none',
    annotationHeaders: null,
    cacheAnchoring: 'none',
    notes: 'DeepSeek has no prompt caching support via standard APIs',
  };
}

function resolveDeepSeekContextWindow(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (id.includes('deepseek-v3') || id.includes('deepseek-chat')) return 64_000;
  if (id.includes('deepseek-coder')) return 16_000;
  if (id.includes('deepseek-r1')) return 64_000;
  return 64_000; // default
}

export async function capabilities(modelId) {
  return deepseekCapabilities(modelId);
}
