/**
 * lib/cache-strategy.js — Model-agnostic cache strategy layer.
 *
 * Follows embeddings-engine.js pattern:
 *   - This file is the model-agnostic router.
 *   - Provider-specific logic lives in cache-strategy-*.js adapters.
 *   - All adapters return the same annotation shape.
 *
 * Consumes provider capabilities from provider-capabilities.js.
 * Emits provider-specific annotations for the dispatch layer.
 *
 * Standard annotation interface (all adapters return this shape):
 *   - messages: array (annotated message array ready for LLM API)
 *   - annotations: array (provider-specific annotation metadata)
 *   - expectedCacheWriteTokens: number | null
 *   - expectedCacheReadTokens: number | null
 */
import { resolveProviderCapabilities } from './provider-capabilities.js';
import { estimateTokens } from './token-engine.js';

const ADAPTERS = {
  anthropic: () => import('./cache-strategy-anthropic.js'),
  google: () => import('./cache-strategy-google.js'),
  openai: () => import('./cache-strategy-openai.js'),
  none: () => import('./cache-strategy-none.js'),
};

function resolveAdapterKey(caps) {
  const format = caps?.annotationFormat || 'none';
  if (ADAPTERS[format]) return format;
  return 'none';
}

/**
 * Annotate a prompt structure with provider-specific cache annotations.
 *
 * @param {object} promptStructure - { system, messages, staticEndIndex, totalTokens }
 * @param {string} modelId
 * @returns {Promise<object>} - { messages, annotations, expectedCacheWriteTokens }
 */
export async function annotatePrompt(promptStructure, modelId) {
  const caps = await resolveProviderCapabilities(modelId);
  const adapterKey = resolveAdapterKey(caps);

  try {
    const { annotate } = await ADAPTERS[adapterKey]();
    return await annotate(promptStructure, caps);
  } catch {
    // Fallback to none
    const { annotate } = await ADAPTERS.none();
    return await annotate(promptStructure, caps);
  }
}

/**
 * Estimate how many tokens should be cacheable from a prompt structure.
 *
 * @param {object} fragments - prompt fragments array
 * @param {number} staticEndIndex - last index that is cacheable
 * @param {object} opts - { modelId }
 * @returns {Promise<number>}
 */
export async function estimateCacheableTokens(fragments, staticEndIndex, { modelId = '' } = {}) {
  if (!Array.isArray(fragments) || staticEndIndex < 0) return 0;

  let total = 0;
  const endIdx = Math.min(staticEndIndex + 1, fragments.length);

  for (let i = 0; i < endIdx; i++) {
    const frag = fragments[i];
    if (frag && frag.content) {
      total += await estimateTokens(frag.content, { modelId });
    }
  }

  return total;
}

/**
 * Resolve cache TTL in tokens (not ms) for a given provider.
 *
 * @param {string} modelId
 * @returns {Promise<{ ttl5m: number, ttl1h: number }>}
 */
export async function resolveCacheTTL(modelId) {
  const caps = await resolveProviderCapabilities(modelId);
  return {
    ttl5m: caps?.cacheTTL?.['5m'] || 0,
    ttl1h: caps?.cacheTTL?.['1h'] || 0,
  };
}
