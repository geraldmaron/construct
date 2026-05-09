/**
 * lib/cache-strategy-openai.js — OpenAI cache strategy.
 *
 * OpenAI uses automatic prefix caching (no annotations needed).
 * Cache is triggered by stable prefixes in the prompt.
 * The structured composition (static system + dynamic suffix) naturally triggers it.
 */
import { estimateTokens } from './token-engine.js';

/**
 * Annotate prompt structure for OpenAI models.
 * Note: OpenAI uses automatic prefix caching — no annotations needed.
 *
 * @param {object} promptStructure - { system, messages }
 * @param {object} caps - Provider capabilities
 * @returns {Promise<object>}
 */
export async function annotate(promptStructure, caps) {
  const { system, messages } = promptStructure || {};

  // OpenAI: automatic prefix caching — no annotations
  // Just ensure stable system prefix is at the start
  const stablePrefix = system || '';
  const expectedCacheableTokens = stablePrefix
    ? await estimateTokens(stablePrefix, { modelId: 'openai/gpt-4o' })
    : 0;

  return {
    messages: messages || [],
    annotations: [
      {
        type: 'automatic_prefix',
        note: 'OpenAI caches repeated prefixes automatically',
        expectedPrefixTokens: expectedCacheableTokens,
      },
    ],
    expectedCacheWriteTokens: expectedCacheableTokens,
    expectedCacheReadTokens: 0, // OpenAI doesn't expose cache hit/miss
  };
}

export async function capabilities() {
  return {
    supportsAnnotations: false,
    annotationType: 'automatic_prefix',
    visibleCacheMetrics: false,
  };
}
