/**
 * lib/provider-capabilities-anthropic.js — Anthropic provider capabilities.
 *
 * Anthropic supports cache_control annotations on system messages and tool definitions.
 * Header required: anthropic-version: 2024-10-22
 * Cache TTL: 5m and 1h (ephemeral variants)
 */
import { resolveProviderCapabilities as _fallback } from './provider-capabilities.js';

export function anthropicCapabilities(modelId = '') {
  // Resolve context window based on model
  const contextWindow = resolveContextWindow(modelId);

  return {
    cacheControl: true,
    cacheMechanism: 'annotation',
    cacheTTL: { '5m': 300_000, '1h': 1_200_000 }, // tokens
    structuredOutput: true,
    maxContextWindow: contextWindow,
    tokenRatio: 3.5, // ~3.5 chars per token for Claude
    annotationFormat: 'anthropic',
    annotationHeaders: {
      'anthropic-version': '2024-10-22'
    },
    cacheAnchoring: 'system-message', // where to place the cache_control
    breakpointPlacement: 'after-static', // place breakpoint after static content
  };
}

function resolveContextWindow(modelId) {
  const id = String(modelId || '').toLowerCase();
  // Claude 3.5/4.x models
  if (id.includes('opus-4')) return 200_000;
  if (id.includes('sonnet-4')) return 200_000;
  if (id.includes('haiku-4')) return 200_000;
  if (id.includes('3-5-sonnet')) return 200_000;
  if (id.includes('3-5-haiku')) return 200_000;
  // Default for modern Claude
  return 200_000;
}

export async function capabilities(modelId) {
  return anthropicCapabilities(modelId);
}
