/**
 * lib/token-engine.js — Model-agnostic token estimation engine.
 *
 * Follows embeddings-engine.js pattern:
 *   - This file is the model-agnostic router.
 *   - Provider-specific logic lives in token-estimator-*.js adapters.
 *   - All adapters return: { estimate: function(text): number }
 *
 * Supported providers:
 *   - anthropic → ~3.5 chars/token (Claude)
 *   - openai    → ~4 chars/token (GPT-4o)
 *   - google    → ~4 chars/token (Gemini)
 *   - deepseek  → ~3 chars/token
 *   - default   → ~4 chars/token (conservative)
 */
import { resolveProviderCapabilities } from './provider-capabilities.js';

const ADAPTERS = {
  anthropic: () => import('./token-estimator-anthropic.js'),
  'anthropic-direct': () => import('./token-estimator-anthropic.js'),
  openai: () => import('./token-estimator-openai.js'),
  'openai-direct': () => import('./token-estimator-openai.js'),
  google: () => import('./token-estimator-google.js'),
  'google-direct': () => import('./token-estimator-google.js'),
  deepseek: () => import('./token-estimator-deepseek.js'),
  default: () => import('./token-estimator-default.js'),
};

function resolveAdapterKey(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (/^anthropic\//.test(id) || /^openrouter\/anthropic\//.test(id)) return 'anthropic';
  if (/^openai\//.test(id) || /^openrouter\/openai\//.test(id) || /^github-copilot\//.test(id)) return 'openai';
  if (/^google\//.test(id) || /^openrouter\/google\//.test(id)) return 'google';
  if (/^deepseek\//.test(id) || /^openrouter\/deepseek\//.test(id)) return 'deepseek';
  return 'default';
}

/**
 * Estimate tokens for a given text and model.
 * Uses provider-specific ratios when available, falls back to default.
 *
 * @param {string} text
 * @param {object} opts - { modelId: string }
 * @returns {Promise<number>}
 */
export async function estimateTokens(text, { modelId = 'default' } = {}) {
  const adapterKey = resolveAdapterKey(modelId);
  const loader = ADAPTERS[adapterKey] || ADAPTERS.default;

  try {
    const { estimate } = await loader();
    return estimate(text);
  } catch {
    // Fallback to default
    const { estimate } = await ADAPTERS.default();
    return estimate(text);
  }
}

/**
 * Synchronous version — uses cached capabilities when possible.
 * Returns 0 on error.
 *
 * @param {string} text
 * @param {object} opts - { modelId: string }
 * @returns {number}
 */
export function estimateTokensSync(text, { modelId = 'default' } = {}) {
  try {
    // Try to get the ratio from provider capabilities (sync)
    const caps = resolveProviderCapabilitiesSync(modelId);
    const ratio = caps?.tokenRatio || 4;
    const len = (text || '').length;
    return Math.ceil(len / ratio);
  } catch {
    // Fallback: 4 chars per token
    return Math.ceil((text || '').length / 4);
  }
}

/**
 * Estimate tokens for an array of texts.
 *
 * @param {string[]} texts
 * @param {object} opts
 * @returns {Promise<number[]>}
 */
export async function estimateTokensBatch(texts, opts = {}) {
  return Promise.all((texts || []).map(t => estimateTokens(t, opts)));
}

/**
 * Estimate the total tokens for a prompt structure (from composePrompt).
 *
 * @param {object} promptStructure - { system, messages, fragments }
 * @param {object} opts
 * @returns {Promise<number>}
 */
export async function estimatePromptTokens(promptStructure, opts = {}) {
  const { system, messages, fragments } = promptStructure || {};
  let total = 0;

  if (system) total += await estimateTokens(system, opts);
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      const content = typeof msg?.content === 'string' ? msg.content : JSON.stringify(msg.content);
      total += await estimateTokens(content, opts);
    }
  }
  if (Array.isArray(fragments)) {
    for (const f of fragments) {
      total += await estimateTokens(f?.content || '', opts);
    }
  }

  return total;
}
