/**
 * lib/provider-capabilities-google.js — Google Gemini provider capabilities.
 *
 * Gemini uses cachedContent API (resource-based caching, not annotations).
 * Cache TTL: 1h via cachedContent resource.
 * Max context window: 1M for Gemini 1.5+, 30k for older models.
 */
import { resolveProviderCapabilities as _fallback } from './provider-capabilities.js';

export function googleCapabilities(modelId = '') {
  const contextWindow = resolveGoogleContextWindow(modelId);

  return {
    cacheControl: true,
    cacheMechanism: 'resource', // uses cachedContent API
    cacheTTL: { '5m': null, '1h': 1_200_000 }, // Gemini uses 1h TTL
    structuredOutput: true,
    maxContextWindow: contextWindow,
    tokenRatio: 4, // ~4 chars per token for Gemini
    annotationFormat: 'google',
    annotationHeaders: null, // Gemini uses separate API endpoint
    cachedContentEndpoint: 'https://generativelanguage.googleapis.com/v1',
    cacheAnchoring: 'cached-content', // reference by name
  };
}

function resolveGoogleContextWindow(modelId) {
  const id = String(modelId || '').toLowerCase();
  // Gemini 1.5+ models
  if (id.includes('gemini-1.5-pro')) return 1_000_000;
  if (id.includes('gemini-1.5-flash')) return 1_000_000;
  if (id.includes('gemini-2.0-pro')) return 1_000_000;
  if (id.includes('gemini-2.0-flash')) return 1_000_000;
  if (id.includes('gemini-2.5-pro')) return 1_000_000;
  if (id.includes('gemini-2.5-flash')) return 1_000_000;
  // Older models
  if (id.includes('gemini-pro')) return 30_000;
  if (id.includes('gemini-flash')) return 30_000;
  // Gemma (smaller context)
  if (id.includes('gemma')) return 8_000;
  // Default
  return 1_000_000;
}

export async function capabilities(modelId) {
  return googleCapabilities(modelId);
}
