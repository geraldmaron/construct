/**
 * lib/cache-strategy-none.js — Fallback for providers with no cache support.
 *
 * Used by DeepSeek and other providers without prompt caching.
 * Returns messages as-is with no annotations.
 */
/**
 * Annotate prompt structure for providers with no cache support.
 *
 * @param {object} promptStructure - { messages }
 * @returns {Promise<object>}
 */
export async function annotate(promptStructure) {
  const { messages } = promptStructure || {};

  return {
    messages: messages || [],
    annotations: [],
    expectedCacheWriteTokens: 0,
    expectedCacheReadTokens: 0,
  };
}

export async function capabilities() {
  return {
    supportsAnnotations: false,
    annotationType: 'none',
    notes: 'Provider does not support prompt caching',
  };
}
