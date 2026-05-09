/**
 * lib/provider-capabilities-openai.js — OpenAI provider capabilities.
 *
 * OpenAI uses automatic prefix caching (no annotations needed).
 * Cache is invisible — triggered by stable prefixes in the prompt.
 * Structured output via response_format parameter.
 * Max context: 128k for GPT-4o, 8k for older models.
 */
import { resolveProviderCapabilities as _fallback } from './provider-capabilities.js';

export function openaiCapabilities(modelId = '') {
  const contextWindow = resolveOpenAIContextWindow(modelId);

  return {
    cacheControl: false, // automatic — no annotations
    cacheMechanism: 'automatic',
    cacheTTL: null, // invisible to caller
    structuredOutput: true,
    maxContextWindow: contextWindow,
    tokenRatio: 4, // ~4 chars per token for GPT models
    annotationFormat: 'openai',
    annotationHeaders: null,
    cacheAnchoring: 'prefix', // stable prefix caching
    notes: 'OpenAI caches repeated prefixes automatically; no explicit cache_control needed',
  };
}

function resolveOpenAIContextWindow(modelId) {
  const id = String(modelId || '').toLowerCase();
  // GPT-4o series
  if (id.includes('gpt-4o') || id.includes('gpt-4.1')) return 128_000;
  if (id.includes('gpt-4-turbo')) return 128_000;
  if (id.includes('gpt-4')) return 8_000;
  if (id.includes('gpt-3.5')) return 16_000;
  if (id.includes('gpt-3')) return 4_000;
  // o1 series
  if (id.includes('o1')) return 200_000;
  if (id.includes('o3')) return 200_000;
  // Default
  return 128_000;
}

export async function capabilities(modelId) {
  return openaiCapabilities(modelId);
}
