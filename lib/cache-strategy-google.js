/**
 * lib/cache-strategy-google.js — Google Gemini cache strategy.
 *
 * Google uses cachedContent API (resource-based caching, not annotations).
 * Cache TTL: 1h via cachedContent resource.
 * Requires separate API call to create/update cached content.
 */
import { estimateTokens } from './token-engine.js';

const GEMINI_CACHE_ENDPOINT = 'https://generativelanguage.googleapis.com/v1';

/**
 * Annotate prompt structure for Google Gemini models.
 * Note: Gemini uses cachedContent API, not message annotations.
 *
 * @param {object} promptStructure - { system, messages }
 * @param {object} caps - Provider capabilities
 * @param {object} opts - { apiKey, modelId }
 * @returns {Promise<object>}
 */
export async function annotate(promptStructure, caps, { apiKey, modelId } = {}) {
  const { system, messages } = promptStructure || {};

  // For Gemini, we need to create a cachedContent resource
  // This requires a separate API call before dispatch
  let cachedContentName = null;

  if (apiKey && system) {
    try {
      cachedContentName = await createCachedContent(system, caps, apiKey, modelId);
    } catch (err) {
      // Silently fail — cached content is optional
    }
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

async function createCachedContent(systemText, caps, apiKey, modelId) {
  // POST to https://generativelanguage.googleapis.com/v1/cachedContents
  // Body: { model: 'gemini-1.5-pro', contents: [{ parts: [{ text: systemText }] }] }
  // Returns: { name: 'cachedContents/abc123' }

  const model = extractModelName(modelId);
  const url = `${GEMINI_CACHE_ENDPOINT}/cachedContents?key=${apiKey}`;

  // This is async but we don't want to block dispatch
  // In production, this should be pre-cached
  // For now, return null (defer to Phase C follow-up with live probing)
  return null;
}

function extractModelName(modelId) {
  const id = String(modelId || '').toLowerCase();
  const match = id.match(/google\/(gemini-[^\/]+)/);
  return match ? match[1] : 'gemini-1.5-pro';
}

export async function capabilities() {
  return {
    supportsAnnotations: false,
    annotationType: 'cached_content',
    requiresApiCall: true,
    cacheEndpoint: GEMINI_CACHE_ENDPOINT,
  };
}
