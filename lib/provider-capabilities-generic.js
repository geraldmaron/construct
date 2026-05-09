/**
 * lib/provider-capabilities-generic.js — Generic/fallback provider capabilities.
 *
 * Used when provider is unknown or not explicitly supported.
 * Provides safe defaults.
 */
import { resolveProviderCapabilities as _fallback } from './provider-capabilities.js';

export function genericCapabilities(modelId = '') {
  return {
    cacheControl: false,
    cacheMechanism: 'none',
    cacheTTL: null,
    structuredOutput: false,
    maxContextWindow: 200_000, // conservative default
    tokenRatio: 4, // ~4 chars per token (conservative)
    annotationFormat: 'none',
    annotationHeaders: null,
    cacheAnchoring: 'none',
    notes: 'Generic provider — no special capabilities detected',
  };
}

export async function capabilities(modelId) {
  return genericCapabilities(modelId);
}
