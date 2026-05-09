/**
 * lib/cache-strategy-anthropic.js — Anthropic cache annotation strategy.
 *
 * Anthropic supports cache_control annotations on system messages.
 * Header required: anthropic-version: 2024-10-22
 * Cache TTL: 5m and 1h (ephemeral variants)
 */
import { estimateTokens } from './token-engine.js';

/**
 * Annotate prompt structure for Anthropic models.
 *
 * @param {object} promptStructure - { system, messages, staticEndIndex }
 * @param {object} caps - Provider capabilities
 * @returns {Promise<object>} - { messages, annotations, expectedCacheWriteTokens }
 */
export async function annotate(promptStructure, caps) {
  const { system, messages, staticEndIndex } = promptStructure || {};

  // Annotate system message with cache_control
  const annotatedMessages = (messages || []).map((msg, idx) => {
    if (idx === 0 && msg.role === 'system') {
      return {
        ...msg,
        cache_control: { type: 'ephemeral' }, // 5m TTL by default
      };
    }
    return msg;
  });

  // Calculate expected cacheable tokens
  const expectedCacheWriteTokens = staticEndIndex >= 0
    ? await estimateTokens(system || '', { modelId: 'anthropic/claude-opus-4-6' })
    : 0;

  return {
    messages: annotatedMessages,
    annotations: [
      {
        type: 'cache_control',
        placement: 'system-message',
        ttl: caps?.cacheTTL?.['5m'] || 300_000,
        note: 'Anthropic cache_control: ephemeral (5m TTL)',
      },
      {
        type: 'header',
        name: 'anthropic-version',
        value: caps?.annotationHeaders?.['anthropic-version'] || '2024-10-22',
      },
    ],
    expectedCacheWriteTokens,
    expectedCacheReadTokens: 0, // unknown until response
  };
}

export async function capabilities() {
  return {
    supportsAnnotations: true,
    annotationType: 'cache_control',
    requiresHeader: 'anthropic-version',
  };
}
