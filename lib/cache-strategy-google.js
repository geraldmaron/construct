/**
 * lib/cache-strategy-google.js — Google Gemini cache strategy (agnostic skeleton).
 *
 * Gemini uses a resource-based cachedContent API rather than per-message
 * annotations. Construct does not own that integration: this module exposes
 * the same surface as the other cache-strategy adapters and resolves cached
 * resources via a pluggable resolver. The default resolver returns null
 * (no cached resource), which is the safe agnostic default — callers will
 * fall through to a fresh request. Provider plugins or operators can register
 * a resolver via `setCachedContentResolver` to enable resource caching.
 */
import { estimateTokens } from './token-engine.js';

const GEMINI_CACHE_ENDPOINT = 'https://generativelanguage.googleapis.com/v1';

let cachedContentResolver = null;

/**
 * Register a resolver responsible for producing a cachedContent resource name
 * for a given system prompt. Contract:
 *   resolver({ systemText, caps, apiKey, modelId }) -> Promise<string|null>
 * Returning null means no cached resource is available; the annotation is
 * omitted and the request proceeds without a cached prefix.
 */
export function setCachedContentResolver(resolver) {
  cachedContentResolver = typeof resolver === 'function' ? resolver : null;
}

/**
 * Annotate prompt structure for Google Gemini models. Returns the shared
 * annotation shape that every cache-strategy adapter emits.
 *
 * @param {object} promptStructure - { system, messages }
 * @param {object} caps - Provider capabilities
 * @param {object} opts - { apiKey, modelId }
 * @returns {Promise<object>}
 */
export async function annotate(promptStructure, caps, { apiKey, modelId } = {}) {
  const { system, messages } = promptStructure || {};

  let cachedContentName = null;
  if (cachedContentResolver && apiKey && system) {
    try {
      cachedContentName = await cachedContentResolver({ systemText: system, caps, apiKey, modelId });
    } catch { /* resolver failure is non-fatal — fall through with no annotation */ }
  }

  return {
    messages: messages || [],
    annotations: cachedContentName
      ? [
          {
            type: 'cached_content',
            name: cachedContentName,
            ttl: caps?.cacheTTL?.['1h'] || 1_200_000,
            note: 'Gemini cachedContent resource',
          },
        ]
      : [],
    expectedCacheWriteTokens: cachedContentName
      ? await estimateTokens(system || '', { modelId: 'google/gemini-1.5-pro' })
      : 0,
    expectedCacheReadTokens: 0,
  };
}

export async function capabilities() {
  return {
    supportsAnnotations: false,
    annotationType: 'cached_content',
    requiresApiCall: true,
    cacheEndpoint: GEMINI_CACHE_ENDPOINT,
  };
}
