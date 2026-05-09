/**
 * lib/token-estimator-anthropic.js — Anthropic Claude token estimator.
 *
 * Claude models use ~3.5 chars per token (more efficient than GPT).
 * Uses approximation since we can't load the real tokenizer in Node.
 */
export function estimate(text) {
  // Claude: ~3.5 chars per token
  const chars = (text || '').length;
  return Math.ceil(chars / 3.5);
}

export async function estimateBatch(texts) {
  return (texts || []).map(t => estimate(t));
}
